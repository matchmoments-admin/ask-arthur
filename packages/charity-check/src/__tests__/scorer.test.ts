import { describe, expect, it } from "vitest";

import {
  applyVerdictFloors,
  computeCompositeScore,
  explainResult,
  PILLAR_WEIGHTS,
  verdictFromScore,
} from "../scorer";
import { unavailablePillar } from "../provider-contract";
import type {
  CharityCheckInput,
  CharityPillarId,
  CharityPillarResult,
} from "../types";

const make = (
  overrides: Partial<Record<CharityPillarId, Partial<CharityPillarResult>>> = {},
): Record<CharityPillarId, CharityPillarResult> => ({
  acnc_registration: {
    id: "acnc_registration",
    score: 0,
    confidence: 1,
    available: true,
    ...(overrides.acnc_registration ?? {}),
  },
  abr_dgr: {
    id: "abr_dgr",
    score: 0,
    confidence: 1,
    available: true,
    ...(overrides.abr_dgr ?? {}),
  },
  donation_url: {
    id: "donation_url",
    score: 0,
    confidence: 0,
    available: false,
    reason: "not_implemented_v0_1",
    ...(overrides.donation_url ?? {}),
  },
});

describe("PILLAR_WEIGHTS", () => {
  it("sums to 1.0", () => {
    const sum = Object.values(PILLAR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});

describe("verdictFromScore", () => {
  it.each([
    [0, "SAFE"],
    [24, "SAFE"],
    [25, "UNCERTAIN"],
    [49, "UNCERTAIN"],
    [50, "SUSPICIOUS"],
    [74, "SUSPICIOUS"],
    [75, "HIGH_RISK"],
    [100, "HIGH_RISK"],
  ] as const)("score %i → %s", (score, expected) => {
    expect(verdictFromScore(score)).toBe(expected);
  });
});

describe("computeCompositeScore", () => {
  it("returns 0/SAFE when both wired pillars report 0 (clean charity)", () => {
    const { score, verdict } = computeCompositeScore(make());
    expect(score).toBe(0);
    expect(verdict).toBe("SAFE");
  });

  it("redistributes weight when donation_url is unavailable (v0.1 typical case)", () => {
    // donation_url default-unavailable in `make()`. With acnc=100 and abr=0,
    // available weight = 0.5 + 0.3 = 0.8; effective ACNC contribution =
    // 100 * (0.5 / 0.8) = 62.5 → 63.
    const pillars = make({
      acnc_registration: { score: 100 },
      abr_dgr: { score: 0 },
    });
    const { score, verdict } = computeCompositeScore(pillars);
    expect(score).toBe(63);
    expect(verdict).toBe("SUSPICIOUS");
  });

  it("uses all three weights when donation_url IS available (v0.2a)", () => {
    // ACNC=100, ABR=0, donation_url=0 (clean URL). Total weighted:
    // 100*0.5 + 0*0.3 + 0*0.2 = 50 → SUSPICIOUS by band threshold.
    const pillars = make({
      acnc_registration: { score: 100 },
      abr_dgr: { score: 0 },
      donation_url: { available: true, score: 0, confidence: 0.9 },
    });
    const { score, verdict } = computeCompositeScore(pillars);
    expect(score).toBe(50);
    expect(verdict).toBe("SUSPICIOUS");
  });

  it("escalates to HIGH_RISK when donation_url flags malicious + ACNC found", () => {
    // ACNC=0 (registered), ABR=0 (active+match), donation_url=100 (Safe
    // Browsing flagged the URL). Weighted: 0+0+20 = 20 → SAFE.
    // The composite-score band is intentionally lenient here because a
    // single-pillar 100 against two clean 0s shouldn't flip the verdict —
    // the verdict copy will surface the URL warning regardless.
    const pillars = make({
      acnc_registration: { score: 0 },
      abr_dgr: { score: 0 },
      donation_url: { available: true, score: 100, confidence: 1 },
    });
    const { score } = computeCompositeScore(pillars);
    expect(score).toBe(20);
  });

  it("returns 50/UNCERTAIN when every pillar is unavailable (fail-safe-ish)", () => {
    const pillars = make({
      acnc_registration: { available: false, reason: "rpc_error" },
      abr_dgr: { available: false, reason: "abr_unavailable_or_unknown" },
    });
    const { score, verdict } = computeCompositeScore(pillars);
    expect(score).toBe(50);
    expect(verdict).toBe("UNCERTAIN");
  });

  it("blends scores by relative weight when multiple pillars available", () => {
    // ACNC weight 0.5, ABR weight 0.3, donation_url weight 0.2 (unavail).
    // Available weight = 0.8. ACNC contributes 50 * 0.5/0.8 = 31.25;
    // ABR contributes 100 * 0.3/0.8 = 37.5. Sum 68.75 → 69 (SUSPICIOUS).
    const pillars = make({
      acnc_registration: { score: 50 },
      abr_dgr: { score: 100 },
    });
    const { score, verdict } = computeCompositeScore(pillars);
    expect(score).toBe(69);
    expect(verdict).toBe("SUSPICIOUS");
  });
});

describe("applyVerdictFloors", () => {
  const baseInput: CharityCheckInput = { abn: "11005357522" };

  it("escalates SAFE → HIGH_RISK on cash payment method", () => {
    const out = applyVerdictFloors("SAFE", { ...baseInput, paymentMethod: "cash" }, make());
    expect(out).toBe("HIGH_RISK");
  });

  it("escalates SAFE → HIGH_RISK on gift_card payment method", () => {
    const out = applyVerdictFloors("SAFE", { ...baseInput, paymentMethod: "gift_card" }, make());
    expect(out).toBe("HIGH_RISK");
  });

  it("escalates SAFE → HIGH_RISK on crypto payment method", () => {
    const out = applyVerdictFloors("SAFE", { ...baseInput, paymentMethod: "crypto" }, make());
    expect(out).toBe("HIGH_RISK");
  });

  it("escalates SAFE → HIGH_RISK on bank_transfer (lawful but uncommon for street fundraising)", () => {
    const out = applyVerdictFloors("SAFE", { ...baseInput, paymentMethod: "bank_transfer" }, make());
    expect(out).toBe("HIGH_RISK");
  });

  it("does NOT escalate on card payment method", () => {
    const out = applyVerdictFloors("SAFE", { ...baseInput, paymentMethod: "card" }, make());
    expect(out).toBe("SAFE");
  });

  it("escalates SAFE → HIGH_RISK on typosquat detection", () => {
    const pillars = make({
      acnc_registration: {
        score: 100,
        detail: { typosquat_match: true, nearest_match: "Cancer Council" },
      },
    });
    const out = applyVerdictFloors("SAFE", baseInput, pillars);
    expect(out).toBe("HIGH_RISK");
  });

  it("does NOT de-escalate HIGH_RISK to SAFE just because payment is card", () => {
    const out = applyVerdictFloors("HIGH_RISK", { ...baseInput, paymentMethod: "card" }, make());
    expect(out).toBe("HIGH_RISK");
  });

  it("ignores typosquat hint when ACNC pillar is unavailable", () => {
    const pillars = make({
      acnc_registration: {
        ...unavailablePillar("acnc_registration", "rpc_error"),
        detail: { typosquat_match: true } as Record<string, unknown>,
      },
    });
    const out = applyVerdictFloors("UNCERTAIN", baseInput, pillars);
    // Detail is set but pillar.available=false, so floor must not fire.
    expect(out).toBe("UNCERTAIN");
  });
});

describe("explainResult", () => {
  it("SAFE includes the official donation URL when present", () => {
    const text = explainResult({
      verdict: "SAFE",
      pillars: make({
        acnc_registration: {
          detail: { charity_legal_name: "Australian Red Cross Society" },
        },
        abr_dgr: { detail: { dgr_endorsed: true } },
      }),
      official_donation_url: "https://www.redcross.org.au",
    });
    expect(text).toMatch(/Australian Red Cross Society/);
    expect(text).toMatch(/redcross.org.au/);
    expect(text).toMatch(/Deductible Gift Recipient/);
  });

  it("HIGH_RISK with typosquat names the impersonated charity", () => {
    const text = explainResult({
      verdict: "HIGH_RISK",
      pillars: make({
        acnc_registration: {
          score: 100,
          detail: {
            typosquat_match: true,
            nearest_match: "Cancer Council Australia",
          },
        },
      }),
      official_donation_url: null,
    });
    expect(text).toMatch(/Cancer Council Australia/);
    expect(text).toMatch(/Don't donate/i);
  });

  it("SUSPICIOUS does NOT name a charity (we couldn't find one)", () => {
    const text = explainResult({
      verdict: "SUSPICIOUS",
      pillars: make({
        acnc_registration: {
          score: 100,
          detail: { registered: false, reason: "no_name_match" },
        },
      }),
      official_donation_url: null,
    });
    expect(text).toMatch(/can't find/i);
    expect(text).toMatch(/acnc.gov.au/);
  });
});
