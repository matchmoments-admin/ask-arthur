/**
 * The spotlight ladder — which brand leads the month's post.
 *
 * This is the feature's editorial brain: it decides the single most-read
 * sentence of the edition. It spent its life as a `const` inside an async
 * Supabase function, with its two thresholds as bare literals and no test able
 * to reach it — while the caption's CONSUMERS of its output were pinned nine
 * ways from hand-built fixtures. The producer had never executed under test.
 *
 * Priority: biggest MoM mover → first-time entrant → super fund → globals.
 *
 * TWO INVARIANTS, both learned the hard way:
 *
 *  1. EVERY rung checks `notLastMonth`. The series told the same story twice
 *     running (HESTA led June AND July 2026) before this existed. A new rung
 *     added without the check reintroduces that silently, which is why the
 *     no-repeat filter is applied once here, at the end, rather than repeated
 *     inside each rung's predicate.
 *
 *  2. BOTH comparative rungs require `isClaimable`, not merely the volume
 *     thresholds. Without it the coverage gate is decorative — it was fully
 *     tested and its caveat printed in the caption while the publisher beside
 *     it applied none of it. The Ordinary (1 -> 11) clears `priorClones > 0`
 *     and `delta >= MOVER_MIN_DELTA`, so it would have published as "the
 *     month's sharpest riser" with the gate's own "these brands were excluded"
 *     caveat printed underneath.
 *
 * Pure: no I/O. The caller supplies the ranking, the lookups and the gate.
 */

/** Ignore noise-level movement. A delta, NOT a volume. */
export const MOVER_MIN_DELTA = 10;
/** A first-timer must be material to lead. A volume, NOT a delta. */
export const ENTRANT_MIN_CLONES = 10;

export type Spotlight =
  | {
      kind: "mover";
      brand: string;
      clones: number;
      auRank: number;
      priorClones: number;
      delta: number;
    }
  | {
      kind: "new_entrant";
      brand: string;
      clones: number;
      auRank: number;
      priorClones: number;
    }
  | { kind: "super_fund"; brand: string; clones: number; auRank: number }
  | { kind: "globals"; brand: string; clones: number; auRank: number };

export interface SpotlightInput {
  /** AU brands PLUS watchlisted super funds, ranked by clones DESC. */
  auOrFund: Array<{ brand: string; clones: number }>;
  /** This brand's clone count in the PRIOR month; 0 when absent. */
  priorClonesOf: (brand: string) => number;
  /** The coverage gate. A brand that fails it may not carry a trend claim. */
  isClaimable: (brand: string) => boolean;
  /** What last month's edition actually led with, so we don't repeat it. */
  priorSpotlightBrand: string | null;
  /**
   * False when there is no comparable prior window (month one, or a data gap).
   * Both comparative rungs are then skipped entirely: `priorClonesOf` returns 0
   * for every brand, which would disable the mover rung and make EVERY brand
   * look like a first-time entrant — the caption would publish "wasn't targeted
   * at all last month" directly above its own "This is month one" line.
   */
  momAvailable: boolean;
  /** The month's highest-ranked super fund, if any. */
  superFund: { brand: string; clones: number; auRank: number } | null;
}

export function pickSpotlight(input: SpotlightInput): Spotlight {
  const {
    auOrFund,
    priorClonesOf,
    isClaimable,
    priorSpotlightBrand,
    momAvailable,
    superFund,
  } = input;

  // Invariant 1: applied ONCE, to every candidate, rather than repeated inside
  // each rung — a new rung cannot forget it.
  const notLastMonth = (brand: string) =>
    !priorSpotlightBrand ||
    brand.toLowerCase() !== priorSpotlightBrand.toLowerCase();

  const eligible = momAvailable
    ? auOrFund.filter((r) => notLastMonth(r.brand) && isClaimable(r.brand))
    : [];

  const mover = eligible
    .map((r) => ({
      ...r,
      priorClones: priorClonesOf(r.brand),
      delta: r.clones - priorClonesOf(r.brand),
    }))
    .filter((r) => r.priorClones > 0 && r.delta >= MOVER_MIN_DELTA)
    .sort((a, b) => b.delta - a.delta || a.brand.localeCompare(b.brand))[0];

  // "It wasn't targeted at all last month" is precisely what a mid-month
  // watchlist addition manufactures, so this rung needs the gate even more
  // than the mover does — which `eligible` has already applied.
  const entrant = eligible
    .filter(
      (r) => priorClonesOf(r.brand) === 0 && r.clones >= ENTRANT_MIN_CLONES,
    )
    .sort((a, b) => b.clones - a.clones || a.brand.localeCompare(b.brand))[0];

  const rankOf = (brand: string) =>
    auOrFund.findIndex((r) => r.brand === brand) + 1;

  if (mover) {
    return {
      kind: "mover",
      brand: mover.brand,
      clones: mover.clones,
      auRank: rankOf(mover.brand),
      priorClones: mover.priorClones,
      delta: mover.delta,
    };
  }
  if (entrant) {
    return {
      kind: "new_entrant",
      brand: entrant.brand,
      clones: entrant.clones,
      auRank: rankOf(entrant.brand),
      priorClones: 0,
    };
  }
  // The super-fund rung is NOT coverage-gated: it is a volume statement about
  // the month ("a super fund was the Nth most-targeted brand"), not a trend
  // claim, so it needs no prior month to be honest. It does still respect the
  // no-repeat rule.
  if (superFund && notLastMonth(superFund.brand)) {
    return {
      kind: "super_fund",
      brand: superFund.brand,
      clones: superFund.clones,
      auRank: superFund.auRank,
    };
  }
  return { kind: "globals", brand: "", clones: 0, auRank: 0 };
}
