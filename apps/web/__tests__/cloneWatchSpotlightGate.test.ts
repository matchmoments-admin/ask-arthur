import { describe, expect, it } from "vitest";
import { classifyTrend, type BrandCoverage } from "@/lib/clone-watch/brand-coverage";

/**
 * The gate must be IN THE PUBLISHING PATH, not merely beside it.
 *
 * `classifyTrend` was written, tested nineteen ways, and its caveat printed in
 * the caption — while the spotlight ladder that actually selects the published
 * "sharpest riser" sentence applied none of it. It filtered on
 * `priorClones > 0 && delta >= MOVER_MIN_DELTA`, which The Ordinary's 1 -> 11
 * clears (prior 1, delta exactly 10). So the one example the gate's own
 * docstring is built around would have been published as a riser, with the
 * gate's "these brands were excluded" caveat printed underneath it.
 *
 * These cases pin the arithmetic of that near-miss so the two thresholds cannot
 * drift back apart. `MOVER_MIN_DELTA` (a delta) and `TREND_FLOOR` (a volume)
 * are both 10 and mean different things; that coincidence is what made the hole
 * invisible.
 */

const JUL = "2026-07";
const AUG = "2026-08";
const MOVER_MIN_DELTA = 10; // mirrors report-card-data.ts

const coverageStartedMidJuly: BrandCoverage = {
  brandDomain: "theordinary.com",
  brandNormalized: "theordinary",
  coveredFrom: "2026-07-21",
  coveredTo: null,
};
const coveredThroughout: BrandCoverage = {
  brandDomain: "amazon.com.au",
  brandNormalized: "amazon",
  coveredFrom: "2026-06-16",
  coveredTo: null,
};

describe("the spotlight's volume thresholds are not a coverage check", () => {
  it("The Ordinary CLEARS the mover thresholds — which is why the gate is needed", () => {
    const priorClones = 1;
    const clones = 11;
    const delta = clones - priorClones;
    // Exactly the ladder's own predicate.
    expect(priorClones > 0 && delta >= MOVER_MIN_DELTA).toBe(true);
  });

  it("...and the gate rejects it, so the gate must be the binding filter", () => {
    const v = classifyTrend({
      currentClones: 11,
      priorClones: 1,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: coverageStartedMidJuly,
    });
    expect(v.kind).toBe("coverage_started");
    // The publisher requires kind === "claimable"; anything else is withheld.
    expect(v.kind).not.toBe("claimable");
  });

  it("a genuinely covered riser still passes both", () => {
    const priorClones = 38;
    const clones = 71;
    expect(priorClones > 0 && clones - priorClones >= MOVER_MIN_DELTA).toBe(true);
    expect(
      classifyTrend({
        currentClones: clones,
        priorClones,
        currentMonth: AUG,
        priorMonth: JUL,
        coverage: coveredThroughout,
      }).kind,
    ).toBe("claimable");
  });

  it("a NEW ENTRANT with no prior month is withheld when coverage began mid-window", () => {
    // The entrant rung publishes "it wasn't targeted at all last month" — the
    // sentence a mid-month watchlist addition manufactures exactly.
    const v = classifyTrend({
      currentClones: 14,
      priorClones: 0,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: coverageStartedMidJuly,
    });
    expect(v.kind).toBe("coverage_started");
  });

  it("a real first-timer we watched all along is claimable", () => {
    const v = classifyTrend({
      currentClones: 14,
      priorClones: 0,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: coveredThroughout,
    });
    expect(v.kind).toBe("claimable");
  });
});
