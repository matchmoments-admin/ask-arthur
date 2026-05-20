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
    expect(
      computeCompositeScore({ ...clean, abnStatus: "not-applicable" }).score,
    ).toBe(0);
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

  it("clamps the worst case to 100 / high-concern", () => {
    expect(
      computeCompositeScore({
        domainAgeBand: "fresh",
        abnStatus: "unregistered",
        apivoidVerdict: "risky",
        commerceFlagCount: 5,
      }),
    ).toEqual({ score: 100, band: "high-concern" });
  });

  it("never returns a negative score", () => {
    expect(
      computeCompositeScore({ ...clean, commerceFlagCount: -3 }).score,
    ).toBe(0);
  });
});
