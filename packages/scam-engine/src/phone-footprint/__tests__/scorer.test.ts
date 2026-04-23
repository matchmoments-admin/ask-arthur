import { describe, it, expect } from "vitest";
import {
  computeCompositeScore,
  bandFromScore,
  redactForFree,
  effectiveTier,
  initialCoverage,
  PILLAR_WEIGHTS,
} from "../scorer";
import type { PillarId, PillarResult } from "../types";

// Helper: build a full pillars record with a baseline of available=false.
function emptyPillars(): Record<PillarId, PillarResult> {
  return {
    scam_reports: { id: "scam_reports", score: 0, confidence: 0, available: false },
    breach: { id: "breach", score: 0, confidence: 0, available: false },
    reputation: { id: "reputation", score: 0, confidence: 0, available: false },
    sim_swap: { id: "sim_swap", score: 0, confidence: 0, available: false },
    identity: { id: "identity", score: 0, confidence: 0, available: false },
  };
}

describe("bandFromScore", () => {
  it("maps 0-24 → safe", () => {
    expect(bandFromScore(0)).toBe("safe");
    expect(bandFromScore(24)).toBe("safe");
  });
  it("maps 25-49 → caution", () => {
    expect(bandFromScore(25)).toBe("caution");
    expect(bandFromScore(49)).toBe("caution");
  });
  it("maps 50-74 → high", () => {
    expect(bandFromScore(50)).toBe("high");
    expect(bandFromScore(74)).toBe("high");
  });
  it("maps 75-100 → critical", () => {
    expect(bandFromScore(75)).toBe("critical");
    expect(bandFromScore(100)).toBe("critical");
  });
});

describe("computeCompositeScore", () => {
  it("returns 0/safe when every pillar is unavailable", () => {
    const r = computeCompositeScore(emptyPillars());
    expect(r.score).toBe(0);
    expect(r.band).toBe("safe");
  });

  it("produces the weighted sum when every pillar is available", () => {
    const p = emptyPillars();
    // Fill every pillar with score 100 → composite should be 100
    for (const id of Object.keys(p) as PillarId[]) {
      p[id] = { id, score: 100, confidence: 1, available: true };
    }
    expect(computeCompositeScore(p).score).toBe(100);
  });

  it("redistributes weight when Vonage pillars are unavailable", () => {
    // Scenario: internal=100, identity=100, breach=100, reputation/sim_swap down.
    // Available weight = 0.30 + 0.10 + 0.20 = 0.60.
    // Composite = (100 * 0.30 / 0.60) + (100 * 0.20 / 0.60) + (100 * 0.10 / 0.60) = 100.
    const p = emptyPillars();
    p.scam_reports = { id: "scam_reports", score: 100, confidence: 1, available: true };
    p.breach = { id: "breach", score: 100, confidence: 1, available: true };
    p.identity = { id: "identity", score: 100, confidence: 1, available: true };
    expect(computeCompositeScore(p).score).toBe(100);
  });

  it("clamps score to [0, 100]", () => {
    const p = emptyPillars();
    p.scam_reports = { id: "scam_reports", score: 200, confidence: 1, available: true };
    // Only scam_reports available → weight 1.0 → score 200 clamps to 100.
    expect(computeCompositeScore(p).score).toBe(100);
  });

  it("verifies pillar weights sum to 1.0 (contract)", () => {
    const sum = Object.values(PILLAR_WEIGHTS).reduce((a, b) => a + b, 0);
    // Float tolerance — 0.3 + 0.2 + 0.25 + 0.15 + 0.10 = 1.0 exactly with IEEE 754.
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });
});

describe("redactForFree", () => {
  it("strips pillar detail, keeping only triggered/not triggered", () => {
    const p = emptyPillars();
    p.scam_reports = {
      id: "scam_reports",
      score: 75,
      confidence: 1,
      available: true,
      detail: { total_reports: 4, breaches: ["Optus"] },
    };
    const redacted = redactForFree(p);
    // Score becomes binary (1 for triggered, 0 otherwise). Detail gone.
    expect(redacted.scam_reports.score).toBe(1);
    expect(redacted.scam_reports.detail).toBeUndefined();
    expect(redacted.scam_reports.confidence).toBe(0);
    // Unavailable pillars still map to 0.
    expect(redacted.breach.score).toBe(0);
    expect(redacted.breach.available).toBe(false);
  });

  it("treats an available pillar with score 0 as not-triggered", () => {
    const p = emptyPillars();
    p.scam_reports = { id: "scam_reports", score: 0, confidence: 1, available: true };
    const r = redactForFree(p);
    expect(r.scam_reports.score).toBe(0);
    expect(r.scam_reports.available).toBe(true);
  });
});

describe("effectiveTier", () => {
  it("downgrades any tier to teaser when ownership not proven", () => {
    expect(
      effectiveTier({ requestedTier: "full", ownershipProven: false, crossIpDowngrade: false }),
    ).toBe("teaser");
    expect(
      effectiveTier({ requestedTier: "basic", ownershipProven: false, crossIpDowngrade: false }),
    ).toBe("teaser");
  });

  it("downgrades any tier to teaser on cross-IP detection even with ownership", () => {
    expect(
      effectiveTier({ requestedTier: "full", ownershipProven: true, crossIpDowngrade: true }),
    ).toBe("teaser");
  });

  it("preserves requested tier when ownership proven and no downgrade", () => {
    expect(
      effectiveTier({ requestedTier: "full", ownershipProven: true, crossIpDowngrade: false }),
    ).toBe("full");
  });
});

describe("initialCoverage", () => {
  it("defaults every external provider to disabled and internal/twilio to degraded", () => {
    const c = initialCoverage();
    expect(c.vonage).toBe("disabled");
    expect(c.leakcheck).toBe("disabled");
    expect(c.ipqs).toBe("disabled");
    expect(c.twilio).toBe("degraded");
    expect(c.internal).toBe("degraded");
  });
});
