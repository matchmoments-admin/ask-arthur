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
    scamUrlListed: false,
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

  it("a one-edit typosquat (levenshtein) scores its band", () => {
    const r = scoreCheckoutGuard(
      signals({ lexical: { brand: "Aesop", signalType: "levenshtein" } }),
    );
    expect(r.score).toBe(40);
    expect(r.verdict).toBe("SUSPICIOUS");
  });

  it("an active scam_urls listing is a corroborating signal: SUSPICIOUS alone, never SAFE (regression)", () => {
    // Regression for the "threat-list arm is inert" finding (was 15 → SAFE) AND
    // the FP finding (scam_urls has legit brands with bare-host phishing, so a
    // match alone must not assert HIGH_RISK "reported as a scam"). Alone →
    // SUSPICIOUS; with a lexical lookalike → HIGH_RISK.
    const listed = scoreCheckoutGuard(signals({ scamUrlListed: true }));
    expect(listed.score).toBe(35);
    expect(listed.verdict).toBe("SUSPICIOUS");
    expect(listed.reasons[0]).toContain("threat list");
    // corroborated by a confusable lookalike (35 + 45 = 80) → HIGH_RISK
    const corroborated = scoreCheckoutGuard(
      signals({
        scamUrlListed: true,
        lexical: { brand: "The Ordinary", signalType: "confusable" },
      }),
    );
    expect(corroborated.verdict).toBe("HIGH_RISK");
    // not listed → contributes nothing
    expect(scoreCheckoutGuard(signals({ scamUrlListed: false })).score).toBe(0);
  });

  it("the dominant AU case — confusable lookalike + unassessed age — is SUSPICIOUS", () => {
    const r = scoreCheckoutGuard(
      signals({
        lexical: { brand: "The Ordinary", signalType: "confusable" },
        domainAgeBand: null, // .au / clean → WHOIS skipped by the route
      }),
    );
    expect(r.score).toBe(45);
    expect(r.verdict).toBe("SUSPICIOUS");
  });

  it("threshold boundaries: exactly 25 → SUSPICIOUS, exactly 60 → HIGH_RISK", () => {
    // fresh(25) alone hits the SUSPICIOUS floor exactly.
    expect(scoreCheckoutGuard(signals({ domainAgeBand: "fresh" })).verdict).toBe("SUSPICIOUS");
    // scam_urls(35) + fresh(25) = 60 hits the HIGH_RISK floor exactly.
    expect(
      scoreCheckoutGuard(signals({ scamUrlListed: true, domainAgeBand: "fresh" })).verdict,
    ).toBe("HIGH_RISK");
  });

  it("null age band contributes nothing (no points, no reason)", () => {
    const r = scoreCheckoutGuard(signals({ domainAgeBand: null }));
    expect(r).toEqual({ score: 0, verdict: "SAFE", reasons: [] });
  });

  it("an unexpected signal type can't NaN-poison the score into a silent SAFE", () => {
    const r = scoreCheckoutGuard(
      signals({
        // cast past the type to simulate a corrupt value reaching the scorer
        lexical: { brand: "X", signalType: "bogus" as never },
        scamUrlListed: true,
      }),
    );
    // bogus lexical → 0, scam_urls listed → 35; must NOT become NaN → SAFE
    expect(Number.isNaN(r.score)).toBe(false);
    expect(r.score).toBe(35);
    expect(r.verdict).toBe("SUSPICIOUS");
  });

  it("score is capped at 100", () => {
    const r = scoreCheckoutGuard(
      signals({
        lexical: { brand: "Mecca", signalType: "confusable" },
        scamUrlListed: true,
        domainAgeBand: "fresh",
        brandOnPageMismatch: true,
      }),
    );
    // 45 + 35 + 25 + 20 = 125 → capped
    expect(r.score).toBe(100);
    expect(r.verdict).toBe("HIGH_RISK");
  });
});
