import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyTrend, type BrandCoverage } from "@/lib/clone-watch/brand-coverage";
import {
  ENTRANT_MIN_CLONES,
  MOVER_MIN_DELTA,
  pickSpotlight,
} from "@/lib/clone-watch/spotlight";

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
 * These cases previously had to assert the ladder's arithmetic second-hand,
 * because the ladder was a `const` inside an async Supabase function and no
 * test could reach it. It now lives in spotlight.ts and is exercised directly.
 */

const JUL = "2026-07";
const AUG = "2026-08";

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

/** The ladder's inputs, with every gate open unless a case closes one. */
function ladder(over: Partial<Parameters<typeof pickSpotlight>[0]> = {}) {
  return pickSpotlight({
    auOrFund: [],
    priorClonesOf: () => 0,
    isClaimable: () => true,
    priorSpotlightBrand: null,
    momAvailable: true,
    superFund: null,
    ...over,
  });
}

describe("the volume thresholds are not a coverage check", () => {
  it("The Ordinary CLEARS the mover thresholds — which is why the gate is needed", () => {
    const priorClones = 1;
    const clones = 11;
    expect(priorClones > 0 && clones - priorClones >= MOVER_MIN_DELTA).toBe(true);
  });

  it("...and the gate rejects it", () => {
    const v = classifyTrend({
      currentClones: 11,
      priorClones: 1,
      currentMonth: AUG,
      priorMonth: JUL,
      coverage: [coverageStartedMidJuly],
    });
    expect(v.kind).toBe("coverage_started");
    expect(v.kind).not.toBe("claimable");
  });
});

describe("pickSpotlight binds the coverage gate", () => {
  const ordinary = [{ brand: "theordinary.com", clones: 11 }];

  it("WITHHOLDS a brand that clears the volume bar but fails the gate", () => {
    const sp = ladder({
      auOrFund: ordinary,
      priorClonesOf: () => 1,
      isClaimable: () => false,
    });
    expect(sp.kind).toBe("globals");
    expect(sp.brand).toBe("");
  });

  it("publishes the same brand once the gate passes — so the gate is the binding filter", () => {
    const sp = ladder({
      auOrFund: ordinary,
      priorClonesOf: () => 1,
      isClaimable: () => true,
    });
    expect(sp.kind).toBe("mover");
    expect(sp.brand).toBe("theordinary.com");
  });

  it("gates the NEW ENTRANT rung too — it needs the gate more than the mover does", () => {
    // "It wasn't targeted at all last month" is exactly what a mid-month
    // watchlist addition manufactures.
    const entrant = [{ brand: "mecca.com.au", clones: ENTRANT_MIN_CLONES + 4 }];
    expect(ladder({ auOrFund: entrant, isClaimable: () => false }).kind).toBe(
      "globals",
    );
    expect(ladder({ auOrFund: entrant, isClaimable: () => true }).kind).toBe(
      "new_entrant",
    );
  });

  it("skips BOTH comparative rungs when there is no fair prior month", () => {
    // Without this, priorClonesOf returns 0 for every brand, which disables the
    // mover rung and makes EVERY brand look like a first-time entrant — the
    // caption would publish "wasn't targeted at all last month" directly above
    // its own "This is month one" line.
    const sp = ladder({
      auOrFund: [{ brand: "bonds.com.au", clones: 40 }],
      momAvailable: false,
    });
    expect(sp.kind).toBe("globals");
  });

  it("never repeats last month's spotlight, at any rung", () => {
    const brand = "hesta.com.au";
    // mover
    expect(
      ladder({
        auOrFund: [{ brand, clones: 40 }],
        priorClonesOf: () => 5,
        priorSpotlightBrand: brand,
      }).kind,
    ).toBe("globals");
    // entrant
    expect(
      ladder({ auOrFund: [{ brand, clones: 40 }], priorSpotlightBrand: brand })
        .kind,
    ).toBe("globals");
    // super fund — the series told the same story twice (HESTA led June AND
    // July 2026) before the no-repeat rule existed.
    expect(
      ladder({
        superFund: { brand, clones: 35, auRank: 2 },
        priorSpotlightBrand: brand,
      }).kind,
    ).toBe("globals");
  });

  it("matches the prior spotlight case-insensitively", () => {
    expect(
      ladder({
        superFund: { brand: "HESTA.com.au", clones: 35, auRank: 2 },
        priorSpotlightBrand: "hesta.com.au",
      }).kind,
    ).toBe("globals");
  });

  it("prefers the biggest mover, then the biggest entrant, then the fund", () => {
    const sp = ladder({
      auOrFund: [
        { brand: "a.com.au", clones: 30 },
        { brand: "b.com.au", clones: 60 },
      ],
      priorClonesOf: (b) => (b === "a.com.au" ? 5 : 45),
      superFund: { brand: "hesta.com.au", clones: 35, auRank: 2 },
    });
    // a: delta 25, b: delta 15 — a wins despite b's larger volume.
    expect(sp).toMatchObject({ kind: "mover", brand: "a.com.au", delta: 25 });
  });

  it("reports auRank from the AU-or-fund ranking, not the raw index", () => {
    const sp = ladder({
      auOrFund: [
        { brand: "big.com.au", clones: 90 },
        { brand: "riser.com.au", clones: 40 },
      ],
      priorClonesOf: (b) => (b === "riser.com.au" ? 5 : 88),
    });
    expect(sp).toMatchObject({ kind: "mover", brand: "riser.com.au", auRank: 2 });
  });
});

/**
 * The one thing behaviour cannot prove: that the CARD passes a real gate into
 * the ladder rather than `() => true`. Deleting the verdict check would leave
 * every test above green, because they supply `isClaimable` themselves. So this
 * asserts the wiring in the source, the way reportCardSlideCount.test.ts does
 * for the deck.
 */
const REPORT_CARD = new URL("../lib/clone-watch/report-card.ts", import.meta.url);

describe("the card wires a real gate into the ladder", () => {
  const src = readFileSync(REPORT_CARD, "utf8");

  it("passes isClaimable derived from the trend verdict", () => {
    expect(src).toMatch(/isClaimable:\s*\(brand\)\s*=>/);
    expect(src).toMatch(/verdictByBrand\.get\(brand\)\?\.kind === "claimable"/);
    // Fails closed when coverage could not be read at all.
    expect(src).toMatch(/brandTrends\.publishable/);
  });

  it("does not hand the ladder a constant", () => {
    expect(src).not.toMatch(/isClaimable:\s*\(\)\s*=>\s*true/);
  });
});
