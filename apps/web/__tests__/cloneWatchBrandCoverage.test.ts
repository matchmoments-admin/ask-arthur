import { describe, expect, it } from "vitest";
import {
  TREND_FLOOR,
  classifyTrend,
  coveredForWholeMonth,
  summariseTrendExclusions,
  type BrandCoverage,
} from "@/lib/clone-watch/brand-coverage";

/**
 * The cases below are REAL prod figures (Jul vs Aug 2026), not invented
 * fixtures, because the gate exists to stop a specific false publication:
 * "The Ordinary up 11x" and "Mecca up 4x" were the two strongest headlines for
 * the first targeting report, and both are artefacts of the 2026-07-21
 * watchlist commit that first added them.
 */
const JUL = "2026-07";
const AUG = "2026-08";

// Added 2026-07-21, with nine other beauty brands.
const BEAUTY_COHORT: BrandCoverage = {
  brandDomain: "theordinary.com",
  brandNormalized: "theordinary",
  coveredFrom: "2026-07-21",
  coveredTo: null,
};
// Amazon's real coverage start, from the backfilled prod record: the
// 2026-06-16 expansion. Covers the whole of both July and August, so it is the
// canonical claimable case.
const LONG_COVERED: BrandCoverage = {
  brandDomain: "amazon.com.au",
  brandNormalized: "amazon",
  coveredFrom: "2026-06-16",
  coveredTo: null,
};

describe("coveredForWholeMonth", () => {
  it("accepts coverage starting before the month", () => {
    expect(coveredForWholeMonth(LONG_COVERED, AUG)).toBe(true);
  });

  it("accepts coverage starting exactly on the first of the month", () => {
    expect(
      coveredForWholeMonth({ ...LONG_COVERED, coveredFrom: "2026-08-01" }, AUG),
    ).toBe(true);
  });

  it("rejects coverage starting mid-month — a partial month is not comparable", () => {
    expect(coveredForWholeMonth(BEAUTY_COHORT, JUL)).toBe(false);
  });

  it("rejects a brand removed before the month ended", () => {
    expect(
      coveredForWholeMonth(
        { ...LONG_COVERED, coveredTo: "2026-08-14" },
        AUG,
      ),
    ).toBe(false);
  });

  it("treats a missing coverage record as NOT covered", () => {
    // Fail closed: an unknown coverage window must never be assumed complete,
    // or the gate passes exactly the rows it cannot vouch for.
    expect(coveredForWholeMonth(null, AUG)).toBe(false);
  });
});

describe("classifyTrend", () => {
  it("BLOCKS The Ordinary 1 -> 11 as coverage_started, not a surge", () => {
    const v = classifyTrend({
      currentClones: 11,
      priorClones: 1,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: BEAUTY_COHORT,
    });
    expect(v.kind).toBe("coverage_started");
    expect(v.pct).toBeNull();
  });

  it("BLOCKS Mecca 3 -> 12 as coverage_started", () => {
    const v = classifyTrend({
      currentClones: 12,
      priorClones: 3,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: { ...BEAUTY_COHORT, brandNormalized: "mecca" },
    });
    expect(v.kind).toBe("coverage_started");
  });

  it("ALLOWS Amazon 38 -> 71 with a percentage", () => {
    const v = classifyTrend({
      currentClones: 71,
      priorClones: 38,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: LONG_COVERED,
    });
    expect(v.kind).toBe("claimable");
    expect(v.delta).toBe(33);
    expect(v.pct).toBe(87);
  });

  it("ALLOWS Bonds 16 -> 28 with a percentage", () => {
    const v = classifyTrend({
      currentClones: 28,
      priorClones: 16,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: { ...LONG_COVERED, brandDomain: "bonds.com.au", brandNormalized: "bonds" },
    });
    expect(v.kind).toBe("claimable");
    expect(v.pct).toBe(75);
  });

  it("uses the DOMAIN key's figures, not the brand-name key's", () => {
    // Kmart is why this matters. Aggregating by target_brand_normalized splits
    // kmart.com.au across TWO name keys ("kmart" 21 + "kmartaustralia" 11), so
    // July reads 21 and Kmart looks like a +62% riser. By the domain key — the
    // one the pipeline actually aggregates on — July is 32 and the real
    // movement is +6%. 72 rows fleet-wide have disagreeing keys. A name-keyed
    // query produces a plausible, publishable, wrong number.
    const v = classifyTrend({
      currentClones: 34,
      priorClones: 32,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: { ...LONG_COVERED, brandDomain: "kmart.com.au", brandNormalized: "kmart" },
    });
    expect(v.kind).toBe("claimable");
    expect(v.delta).toBe(2);
    expect(v.pct).toBe(6);
  });

  it("BLOCKS NAB 2 -> 1 as below_floor", () => {
    const v = classifyTrend({
      currentClones: 1,
      priorClones: 2,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: { ...LONG_COVERED, brandNormalized: "nab" },
    });
    expect(v.kind).toBe("below_floor");
  });

  it("gives iinet 6 -> 16 an absolute delta but NO percentage", () => {
    // Clears the floor in August only. "+10 domains" is honest; "+167%" off a
    // base of six is arithmetic dressed as a trend.
    const v = classifyTrend({
      currentClones: 16,
      priorClones: 6,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: { ...LONG_COVERED, brandNormalized: "iinet" },
    });
    expect(v.kind).toBe("claimable");
    expect(v.delta).toBe(10);
    expect(v.pct).toBeNull();
  });

  it("checks coverage BEFORE the floor", () => {
    // A newly-monitored brand that is also small must report the coverage
    // reason. Reporting "below_floor" would hide the confound behind a volume
    // excuse, and the caveat line would then understate how many brands were
    // excluded for monitoring changes.
    const v = classifyTrend({
      currentClones: 2,
      priorClones: 0,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: BEAUTY_COHORT,
    });
    expect(v.kind).toBe("coverage_started");
  });

  it("reports coverage_unknown rather than assuming coverage", () => {
    const v = classifyTrend({
      currentClones: 50,
      priorClones: 10,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: null,
    });
    expect(v.kind).toBe("coverage_unknown");
    expect(v.pct).toBeNull();
  });

  it("TREND_FLOOR is the published threshold", () => {
    // Pinned so a future tweak has to change the test and face the question.
    expect(TREND_FLOOR).toBe(10);
  });
});

describe("summariseTrendExclusions", () => {
  it("counts each reason so the post's caveat cannot drift from the gate", () => {
    const verdicts = [
      classifyTrend({ currentClones: 71, priorClones: 38, currentMonth: AUG, priorMonth: JUL, coverage: LONG_COVERED }),
      classifyTrend({ currentClones: 11, priorClones: 1, currentMonth: AUG, priorMonth: JUL, coverage: BEAUTY_COHORT }),
      classifyTrend({ currentClones: 1, priorClones: 2, currentMonth: AUG, priorMonth: JUL, coverage: LONG_COVERED }),
      classifyTrend({ currentClones: 5, priorClones: 5, currentMonth: AUG, priorMonth: JUL, coverage: null }),
    ];
    expect(summariseTrendExclusions(verdicts)).toEqual({
      claimable: 1,
      coverageStarted: 1,
      coverageEnded: 0,
      belowFloor: 1,
      unknown: 1,
    });
  });
});

describe("coverage that ENDED (review finding)", () => {
  // A brand de-listed mid-window looks identical to a collapse in targeting.
  // Reporting it as "coverage_started" would make the derived caveat say "we
  // started watching these" about brands we STOPPED watching — the opposite of
  // what happened. Real cases: Domain (domain.com.au) and Lendi
  // (lendi.com.au) left the watchlist on 2026-06-07.
  const DELISTED: BrandCoverage = {
    brandDomain: "domain.com.au",
    brandNormalized: "domain",
    coveredFrom: "2026-05-26",
    coveredTo: "2026-06-07",
  };

  it("classifies a de-listed brand as coverage_ended, not coverage_started", () => {
    const v = classifyTrend({
      currentClones: 0,
      priorClones: 40,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: DELISTED,
    });
    expect(v.kind).toBe("coverage_ended");
  });

  it("counts the two coverage reasons separately", () => {
    const verdicts = [
      classifyTrend({ currentClones: 0, priorClones: 40, currentMonth: AUG, priorMonth: JUL, coverage: DELISTED }),
      classifyTrend({ currentClones: 11, priorClones: 1, currentMonth: AUG, priorMonth: JUL, coverage: BEAUTY_COHORT }),
    ];
    const s = summariseTrendExclusions(verdicts);
    expect(s.coverageEnded).toBe(1);
    expect(s.coverageStarted).toBe(1);
  });
});

describe("malformed period months (review finding)", () => {
  it("throws rather than failing OPEN on an unpadded month", () => {
    // new Date("2026-8-01T00:00:00Z") is Invalid Date, and every comparison
    // against NaN is false — so the gate would skip both rejection branches and
    // return true, making EVERY brand claimable. A fail-closed gate must not
    // fail open on a malformed input.
    expect(() => coveredForWholeMonth(LONG_COVERED, "2026-8")).toThrow(
      /unparseable periodMonth/,
    );
  });
});
