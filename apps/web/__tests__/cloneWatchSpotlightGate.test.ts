import { readFileSync } from "node:fs";
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
      coverage: [coverageStartedMidJuly],
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
        coverage: [coveredThroughout],
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
      coverage: [coverageStartedMidJuly],
    });
    expect(v.kind).toBe("coverage_started");
  });

  it("a real first-timer we watched all along is claimable", () => {
    const v = classifyTrend({
      currentClones: 14,
      priorClones: 0,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: [coveredThroughout],
    });
    expect(v.kind).toBe("claimable");
  });
});

/**
 * Everything above exercises `classifyTrend` as a pure function, which is
 * necessary and NOT sufficient: none of it executes the publisher, so deleting
 * `isClaimable(r.brand) &&` from the two spotlight filters left the whole suite
 * green. That is this repo's own recorded lesson — a tested gate is decorative
 * until it is wired into the publishing path — reappearing in the very test
 * written to prevent it.
 *
 * So assert the wiring in the source, the way reportCardSlideCount.test.ts
 * already does for the deck. Structural rather than behavioural, because the
 * ladder is buried inside a function that needs a Supabase client; the point is
 * only that removing the gate must not be silent.
 */
const REPORT_CARD = new URL("../lib/clone-watch/report-card-data.ts", import.meta.url);

describe("the gate is wired into the publisher, not merely beside it", () => {
  const src = readFileSync(REPORT_CARD, "utf8");

  it("defines isClaimable from the verdict, requiring kind === claimable", () => {
    expect(src).toMatch(/const isClaimable = \(brand: string\) =>/);
    expect(src).toMatch(/verdictByBrand\.get\(brand\)\?\.kind === "claimable"/);
    // Fails closed when coverage could not be read at all.
    expect(src).toMatch(/brandTrends\.publishable &&/);
  });

  it("applies it on BOTH comparative spotlight rungs", () => {
    // The mover and the entrant are separate filters; the entrant rung needs it
    // more, since "wasn't targeted at all last month" is exactly what a
    // mid-month watchlist addition manufactures.
    const uses = [...src.matchAll(/isClaimable\(r\.brand\)/g)];
    expect(
      uses.length,
      "isClaimable must gate both the mover and the new-entrant rungs",
    ).toBe(2);
  });

  it("mirrors the same MOVER_MIN_DELTA this file asserts against", () => {
    // The constant is duplicated here deliberately (the ladder is not
    // exported); pin it so the mirror cannot drift from the original.
    const m = /const MOVER_MIN_DELTA = (\d+);/.exec(src);
    expect(m, "MOVER_MIN_DELTA not found in report-card-data.ts").not.toBeNull();
    expect(Number(m![1])).toBe(MOVER_MIN_DELTA);
  });
});
