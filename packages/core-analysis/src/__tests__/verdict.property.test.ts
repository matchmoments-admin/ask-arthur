import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Verdict } from "@askarthur/types";
import {
  mergeVerdict,
  verdictRank,
  type VerdictSignals,
  type AiSignal,
  type UrlReputationSignal,
  type RedirectChainSignal,
  type InjectionSignal,
  type DeepfakeSignal,
} from "../verdict";

// ── Arbitraries ──

const verdictArb: fc.Arbitrary<Verdict> = fc.constantFrom<Verdict>(
  "SAFE",
  "UNCERTAIN",
  "SUSPICIOUS",
  "HIGH_RISK"
);

const aiSignalArb: fc.Arbitrary<AiSignal> = fc.record({
  verdict: verdictArb,
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  summary: fc.string({ maxLength: 200 }),
  redFlags: fc.array(fc.string({ maxLength: 100 }), { maxLength: 5 }),
  nextSteps: fc.array(fc.string({ maxLength: 100 }), { maxLength: 5 }),
});

const urlResultArb: fc.Arbitrary<UrlReputationSignal> = fc.record({
  url: fc.webUrl(),
  isMalicious: fc.boolean(),
  sources: fc.array(fc.constantFrom("google-safebrowsing", "virustotal", "local"), {
    maxLength: 3,
  }),
});

const redirectChainArb: fc.Arbitrary<RedirectChainSignal> = fc.record({
  originalUrl: fc.webUrl(),
  finalUrl: fc.webUrl(),
  hopCount: fc.integer({ min: 1, max: 20 }),
  isShortened: fc.boolean(),
  hasOpenRedirect: fc.boolean(),
  truncated: fc.boolean(),
});

const injectionArb: fc.Arbitrary<InjectionSignal> = fc.record({
  detected: fc.boolean(),
  patterns: fc.array(fc.string({ maxLength: 80 }), { maxLength: 3 }),
});

const deepfakeArb: fc.Arbitrary<DeepfakeSignal> = fc.record(
  {
    detected: fc.option(fc.boolean(), { nil: undefined }),
    score: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
    provider: fc.constantFrom("hive", "reality-defender", "resemble"),
    isAiGenerated: fc.option(fc.boolean(), { nil: undefined }),
  },
  { requiredKeys: ["provider"] }
);

const signalsArb: fc.Arbitrary<VerdictSignals> = fc.record(
  {
    ai: aiSignalArb,
    urlResults: fc.option(fc.array(urlResultArb, { maxLength: 5 }), { nil: undefined }),
    redirectChains: fc.option(fc.array(redirectChainArb, { maxLength: 3 }), {
      nil: undefined,
    }),
    injection: fc.option(injectionArb, { nil: undefined }),
    deepfake: fc.option(deepfakeArb, { nil: undefined }),
  },
  { requiredKeys: ["ai"] }
);

// ── Property: idempotence ──

describe("mergeVerdict: pure function invariants", () => {
  it("is idempotent — same input yields equal output on repeat calls", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const a = mergeVerdict(signals);
        const b = mergeVerdict(signals);
        expect(a).toEqual(b);
      })
    );
  });

  it("never throws on any well-typed input", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        expect(() => mergeVerdict(signals)).not.toThrow();
      })
    );
  });

  it("never mutates the input signals", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const snapshot = JSON.stringify(signals);
        mergeVerdict(signals);
        expect(JSON.stringify(signals)).toBe(snapshot);
      })
    );
  });
});

// ── Property: escalation dominance ──

describe("mergeVerdict: escalation invariants", () => {
  it("adding a malicious URL never downgrades the final verdict", () => {
    fc.assert(
      fc.property(signalsArb, fc.webUrl(), (signals, maliciousUrl) => {
        const baseline = mergeVerdict(signals);
        const escalated = mergeVerdict({
          ...signals,
          urlResults: [
            ...(signals.urlResults ?? []),
            { url: maliciousUrl, isMalicious: true, sources: ["google-safebrowsing"] },
          ],
        });
        expect(verdictRank(escalated.verdict)).toBeGreaterThanOrEqual(
          verdictRank(baseline.verdict)
        );
      })
    );
  });

  it("at least one malicious URL forces verdict to HIGH_RISK", () => {
    fc.assert(
      fc.property(signalsArb, fc.webUrl(), (signals, url) => {
        const result = mergeVerdict({
          ...signals,
          urlResults: [
            ...(signals.urlResults ?? []),
            { url, isMalicious: true, sources: ["google-safebrowsing"] },
          ],
        });
        expect(result.verdict).toBe("HIGH_RISK");
        expect(result.signals.maliciousUrlCount).toBeGreaterThanOrEqual(1);
      })
    );
  });

  it("injection detected floors verdict at SUSPICIOUS (never SAFE)", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const result = mergeVerdict({
          ...signals,
          injection: { detected: true, patterns: ["test"] },
        });
        expect(result.verdict).not.toBe("SAFE");
        expect(result.signals.injectionDetected).toBe(true);
      })
    );
  });

  it("injection never downgrades an already-HIGH_RISK verdict", () => {
    fc.assert(
      fc.property(
        signalsArb.filter((s) => s.ai.verdict === "HIGH_RISK"),
        (signals) => {
          const result = mergeVerdict({
            ...signals,
            injection: { detected: true, patterns: ["test"] },
          });
          expect(result.verdict).toBe("HIGH_RISK");
        }
      )
    );
  });

  it("deepfake score >= 0.85 forces HIGH_RISK", () => {
    fc.assert(
      fc.property(
        signalsArb,
        fc.double({ min: 0.85, max: 1, noNaN: true }),
        (signals, score) => {
          const result = mergeVerdict({
            ...signals,
            deepfake: { score, provider: "reality-defender" },
          });
          expect(result.verdict).toBe("HIGH_RISK");
          expect(result.signals.deepfakeDetected).toBe(true);
        }
      )
    );
  });

  it("deepfake detected=true (boolean provider) forces HIGH_RISK regardless of score", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const result = mergeVerdict({
          ...signals,
          deepfake: { detected: true, provider: "hive" },
        });
        expect(result.verdict).toBe("HIGH_RISK");
        expect(result.signals.deepfakeDetected).toBe(true);
      })
    );
  });

  it("deepfake score < 0.5 with no boolean detected does not trigger escalation or flag", () => {
    fc.assert(
      fc.property(
        signalsArb,
        fc.double({ min: 0, max: 0.499, noNaN: true }),
        (signals, score) => {
          const baseline = mergeVerdict({ ...signals, deepfake: undefined });
          const withLowScore = mergeVerdict({
            ...signals,
            deepfake: { score, provider: "reality-defender" },
          });
          expect(withLowScore.verdict).toBe(baseline.verdict);
          expect(withLowScore.signals.deepfakeDetected).toBe(false);
        }
      )
    );
  });

  it("isAiGenerated alone adds a red flag but does not escalate verdict", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const baseline = mergeVerdict({ ...signals, deepfake: undefined });
        const withAi = mergeVerdict({
          ...signals,
          deepfake: { isAiGenerated: true, provider: "hive" },
        });
        expect(withAi.verdict).toBe(baseline.verdict);
        expect(withAi.signals.deepfakeDetected).toBe(false);
        expect(withAi.redFlags.some((f) => f.includes("AI-generated"))).toBe(true);
      })
    );
  });
});

// ── Property: red-flag accumulation ──

describe("mergeVerdict: red flag accumulation", () => {
  it("output redFlags length >= input AI redFlags length (merge only adds)", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const result = mergeVerdict(signals);
        expect(result.redFlags.length).toBeGreaterThanOrEqual(
          signals.ai.redFlags.length
        );
      })
    );
  });

  it("preserves every original AI redFlag verbatim", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const result = mergeVerdict(signals);
        for (const flag of signals.ai.redFlags) {
          expect(result.redFlags).toContain(flag);
        }
      })
    );
  });

  it("confidence and summary pass through unchanged from AI signal", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const result = mergeVerdict(signals);
        expect(result.confidence).toBe(signals.ai.confidence);
        expect(result.summary).toBe(signals.ai.summary);
      })
    );
  });

  it("aiVerdict in signals reflects original AI input", () => {
    fc.assert(
      fc.property(signalsArb, (signals) => {
        const result = mergeVerdict(signals);
        expect(result.signals.aiVerdict).toBe(signals.ai.verdict);
      })
    );
  });
});

// ── Property: unit sanity ──

describe("mergeVerdict: unit cases", () => {
  const baseAi: AiSignal = {
    verdict: "SAFE",
    confidence: 0.9,
    summary: "Looks clean.",
    redFlags: [],
    nextSteps: [],
  };

  it("pure SAFE input with no other signals returns SAFE", () => {
    const result = mergeVerdict({ ai: baseAi });
    expect(result.verdict).toBe("SAFE");
    expect(result.signals.maliciousUrlCount).toBe(0);
    expect(result.signals.injectionDetected).toBe(false);
    expect(result.signals.deepfakeDetected).toBe(false);
  });

  it("injects the 'do not click' next step when a URL is malicious", () => {
    const result = mergeVerdict({
      ai: baseAi,
      urlResults: [
        { url: "https://evil.test", isMalicious: true, sources: ["virustotal"] },
      ],
    });
    expect(result.nextSteps[0]).toBe("Do not click any links in this message.");
  });

  it("doesn't duplicate the 'do not click' warning if AI already included it", () => {
    const result = mergeVerdict({
      ai: {
        ...baseAi,
        nextSteps: ["Do not click any links in this message.", "Report to Scamwatch"],
      },
      urlResults: [
        { url: "https://evil.test", isMalicious: true, sources: ["virustotal"] },
      ],
    });
    const warningCount = result.nextSteps.filter(
      (s) => s === "Do not click any links in this message."
    ).length;
    expect(warningCount).toBe(1);
  });

  it("handles empty sources gracefully with a fallback label", () => {
    const result = mergeVerdict({
      ai: baseAi,
      urlResults: [{ url: "https://evil.test", isMalicious: true, sources: [] }],
    });
    expect(result.redFlags.some((f) => f.includes("threat feeds"))).toBe(true);
  });
});

describe("verdictRank: ordering", () => {
  it("ranks verdicts in strict ascending severity", () => {
    expect(verdictRank("SAFE")).toBeLessThan(verdictRank("UNCERTAIN"));
    expect(verdictRank("UNCERTAIN")).toBeLessThan(verdictRank("SUSPICIOUS"));
    expect(verdictRank("SUSPICIOUS")).toBeLessThan(verdictRank("HIGH_RISK"));
  });
});
