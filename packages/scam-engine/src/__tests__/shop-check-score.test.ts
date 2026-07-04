import { describe, expect, it } from "vitest";

import {
  computeCompositeScore,
  scoreToBand,
  bandToVerdict,
} from "../shop-check-score";

describe("scoreToBand", () => {
  it("maps score ranges to concern bands", () => {
    expect(scoreToBand(0)).toBe("low-concern");
    expect(scoreToBand(24)).toBe("low-concern");
    expect(scoreToBand(25)).toBe("some-concern");
    expect(scoreToBand(59)).toBe("some-concern");
    expect(scoreToBand(60)).toBe("high-concern");
    expect(scoreToBand(100)).toBe("high-concern");
  });
});

describe("bandToVerdict", () => {
  it("maps bands to the internal verdict column value", () => {
    expect(bandToVerdict("low-concern")).toBe("SAFE");
    expect(bandToVerdict("some-concern")).toBe("SUSPICIOUS");
    expect(bandToVerdict("high-concern")).toBe("HIGH_RISK");
  });
});

describe("computeCompositeScore", () => {
  const clean = {
    domainAgeBand: "established" as const,
    abnStatus: "verified" as const,
    apivoidVerdict: "safe" as const,
    commerceFlagCount: 0,
    reviewsVerdict: null,
  };

  it("scores a clean established shop at zero / low-concern", () => {
    expect(computeCompositeScore(clean)).toEqual({
      score: 0,
      band: "low-concern",
    });
  });

  it("weights a fresh domain at +35", () => {
    expect(
      computeCompositeScore({ ...clean, domainAgeBand: "fresh" }).score,
    ).toBe(35);
    expect(
      computeCompositeScore({ ...clean, domainAgeBand: "recent" }).score,
    ).toBe(18);
    expect(
      computeCompositeScore({ ...clean, domainAgeBand: "unknown" }).score,
    ).toBe(6);
  });

  it("keeps an unverifiable domain inside low-concern on its own", () => {
    // unknown domain age (6) + no-abn (18) = 24 — calibrated to stay just
    // under the 25-point some-concern threshold.
    const result = computeCompositeScore({
      ...clean,
      domainAgeBand: "unknown",
      abnStatus: "no-abn",
    });
    expect(result.score).toBe(24);
    expect(result.band).toBe("low-concern");
  });

  it("weights ABN status", () => {
    expect(
      computeCompositeScore({ ...clean, abnStatus: "unregistered" }).score,
    ).toBe(30);
    expect(computeCompositeScore({ ...clean, abnStatus: "no-abn" }).score).toBe(
      18,
    );
    expect(
      computeCompositeScore({ ...clean, abnStatus: "name-mismatch" }).score,
    ).toBe(12);
    // `unverified` (the check couldn't run) is a mild corroborating
    // concern, never an accusation — scored like `unknown` domain age.
    expect(
      computeCompositeScore({ ...clean, abnStatus: "unverified" }).score,
    ).toBe(6);
    expect(
      computeCompositeScore({ ...clean, abnStatus: "not-applicable" }).score,
    ).toBe(0);
  });

  it("keeps an unverifiable ABN + unknown domain inside low-concern", () => {
    // unverified ABN (6) + unknown domain (6) = 12 — an enrichment that
    // could not run never tips an otherwise-clean shop.
    const result = computeCompositeScore({
      ...clean,
      domainAgeBand: "unknown",
      abnStatus: "unverified",
    });
    expect(result.score).toBe(12);
    expect(result.band).toBe("low-concern");
  });

  it("weights the APIVoid verdict, treating null as no signal", () => {
    expect(
      computeCompositeScore({ ...clean, apivoidVerdict: "risky" }).score,
    ).toBe(35);
    expect(
      computeCompositeScore({ ...clean, apivoidVerdict: "suspicious" }).score,
    ).toBe(18);
    expect(
      computeCompositeScore({ ...clean, apivoidVerdict: null }).score,
    ).toBe(0);
  });

  it("caps the commerce-flag contribution at three flags (+18)", () => {
    expect(
      computeCompositeScore({ ...clean, commerceFlagCount: 1 }).score,
    ).toBe(6);
    expect(
      computeCompositeScore({ ...clean, commerceFlagCount: 3 }).score,
    ).toBe(18);
    expect(
      computeCompositeScore({ ...clean, commerceFlagCount: 9 }).score,
    ).toBe(18);
  });

  it("weights the fused review verdict, treating null as no signal", () => {
    expect(
      computeCompositeScore({ ...clean, reviewsVerdict: "manipulated" }).score,
    ).toBe(25);
    expect(
      computeCompositeScore({ ...clean, reviewsVerdict: "suspicious" }).score,
    ).toBe(12);
    expect(
      computeCompositeScore({ ...clean, reviewsVerdict: "clean" }).score,
    ).toBe(0);
    expect(
      computeCompositeScore({ ...clean, reviewsVerdict: null }).score,
    ).toBe(0);
  });

  it("never lets manipulated reviews reach high-concern on their own", () => {
    // The +25 ceiling is deliberate: circumstantial review manipulation must
    // corroborate, not railroad. 25 sits at the top of some-concern (< 60).
    const result = computeCompositeScore({
      ...clean,
      reviewsVerdict: "manipulated",
    });
    expect(result.score).toBe(25);
    expect(result.band).toBe("some-concern");
  });

  it("corroborates manipulated reviews with other signals into high-concern", () => {
    // The kouvrfashion shape: no ABN + manipulated reviews is some-concern on
    // its own (18 + 25 = 43), and a suspicious site-reputation verdict (+18)
    // tips it to high-concern (61).
    const noAbnManipulated = computeCompositeScore({
      ...clean,
      abnStatus: "no-abn",
      reviewsVerdict: "manipulated",
    });
    expect(noAbnManipulated.score).toBe(43);
    expect(noAbnManipulated.band).toBe("some-concern");

    const corroborated = computeCompositeScore({
      ...clean,
      abnStatus: "no-abn",
      apivoidVerdict: "suspicious",
      reviewsVerdict: "manipulated",
    });
    expect(corroborated.score).toBe(61);
    expect(corroborated.band).toBe("high-concern");
  });

  it("clamps the worst case to 100 / high-concern", () => {
    expect(
      computeCompositeScore({
        domainAgeBand: "fresh",
        abnStatus: "unregistered",
        apivoidVerdict: "risky",
        commerceFlagCount: 5,
        reviewsVerdict: "manipulated",
      }),
    ).toEqual({ score: 100, band: "high-concern" });
  });

  it("never returns a negative score", () => {
    expect(
      computeCompositeScore({ ...clean, commerceFlagCount: -3 }).score,
    ).toBe(0);
  });
});
