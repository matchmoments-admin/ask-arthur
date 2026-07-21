import { describe, it, expect } from "vitest";
import {
  scoreCheckoutGuard,
  type CheckoutGuardSignals,
} from "../checkout-guard-score";

function signals(
  overrides: Partial<CheckoutGuardSignals> = {},
): CheckoutGuardSignals {
  return {
    lexical: null,
    scamUrl: null,
    domainAgeBand: "established",
    brandOnPageMismatch: false,
    ...overrides,
  };
}

describe("scoreCheckoutGuard", () => {
  it("no signals → SAFE, score 0, no reasons", () => {
    const r = scoreCheckoutGuard(signals());
    expect(r).toEqual({ score: 0, verdict: "SAFE", reasons: [] });
  });

  it("a confusable lookalike alone is SUSPICIOUS (needs corroboration for HIGH)", () => {
    const r = scoreCheckoutGuard(
      signals({ lexical: { brand: "The Ordinary", signalType: "confusable" } }),
    );
    expect(r.score).toBe(45);
    expect(r.verdict).toBe("SUSPICIOUS");
    expect(r.reasons[0]).toContain("The Ordinary");
  });

  it("a lookalike on a freshly-registered domain is HIGH_RISK", () => {
    const r = scoreCheckoutGuard(
      signals({
        lexical: { brand: "Naturium", signalType: "confusable" },
        domainAgeBand: "fresh",
      }),
    );
    expect(r.score).toBe(70); // 45 + 25
    expect(r.verdict).toBe("HIGH_RISK");
    expect(r.reasons).toHaveLength(2);
  });

  it("a known-active scam domain alone clears HIGH_RISK", () => {
    const r = scoreCheckoutGuard(signals({ scamUrl: { threatLevel: "HIGH" } }));
    expect(r.score).toBe(60);
    expect(r.verdict).toBe("HIGH_RISK");
  });

  it("substring lookalike + brand-on-page mismatch is SUSPICIOUS", () => {
    const r = scoreCheckoutGuard(
      signals({
        lexical: { brand: "Sephora", signalType: "substring" },
        brandOnPageMismatch: true,
      }),
    );
    expect(r.score).toBe(55); // 35 + 20
    expect(r.verdict).toBe("SUSPICIOUS");
  });

  it("unknown domain age is never treated as safe-enough to stand alone (SAFE, but scored)", () => {
    const r = scoreCheckoutGuard(signals({ domainAgeBand: "unknown" }));
    expect(r.score).toBe(6);
    expect(r.verdict).toBe("SAFE");
    // no age reason for 'unknown' — only fresh/recent explain themselves
    expect(r.reasons).toEqual([]);
  });

  it("recent age contributes a reason and points", () => {
    const r = scoreCheckoutGuard(signals({ domainAgeBand: "recent" }));
    expect(r.score).toBe(12);
    expect(r.reasons[0]).toContain("recently");
  });

  it("score is capped at 100", () => {
    const r = scoreCheckoutGuard(
      signals({
        lexical: { brand: "Mecca", signalType: "confusable" },
        scamUrl: { threatLevel: "HIGH" },
        domainAgeBand: "fresh",
        brandOnPageMismatch: true,
      }),
    );
    // 45 + 60 + 25 + 20 = 150 → capped
    expect(r.score).toBe(100);
    expect(r.verdict).toBe("HIGH_RISK");
  });
});
