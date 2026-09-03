/**
 * Keep `brand_coverage_history` current (#1075, v294–v297).
 *
 * The git backfill reconstructed history up to the last watchlist commit. This
 * is the going-forward half: it records brands that JOIN the list and closes
 * out brands that LEAVE it, so the trend gate never has to guess again.
 *
 * Both directions matter, and they fail in opposite ways:
 *   - a missing join    → the brand reads coverage_unknown and, because the
 *                         gate fails closed, its trends are suppressed forever;
 *   - a missing closure → a de-listed brand reads as permanently covered, so
 *                         its silence publishes as "targeting collapsed"
 *                         instead of "we stopped looking".
 * Two brands (Domain, Lendi) were already in the second state before the
 * backfill learned to close rows, which is why this runs on a schedule rather
 * than being left to the next manual backfill.
 *
 * Idempotent: safe to run every month, writes only on an actual change.
 *
 * SHAPE: a pure planner plus a caller-owned Adapter, matching ADR-0020's
 * brand-resolver pattern (pure Module in the library, Supabase loader app-side).
 * An earlier version put a `CoverageStore` port here — a 19-line Interface over
 * a 25-line Implementation, with one Adapter written inline in the cron and no
 * second one. That is a hypothetical Seam: it cost more Interface than it
 * bought, and it spoke PostgREST's snake_case vocabulary rather than the
 * domain's. `planCoverageSync` is pure set arithmetic and needs no port to be
 * tested; the cron does the two writes.
 */
import { brandNormalize } from "@askarthur/shopfront-glue";
import { logger } from "@askarthur/utils/logger";

interface CoverageDbRow {
  brand_normalized: string;
  covered_to: string | null;
}

export interface CoverageInsert {
  brand: string;
  brand_normalized: string;
  brand_domain: string;
  covered_from: string;
  source: string;
}

export interface CoveragePlan {
  /** Brands that JOINED and need an open window. */
  toAdd: CoverageInsert[];
  /** brand_normalized keys that LEFT and need closing at `asOf`. */
  toClose: string[];
  unchanged: number;
}

export interface WatchlistSnapshotEntry {
  brand: string;
  legitimate_domains: string[];
}

/**
 * Reconcile the recorded coverage against the live watchlist.
 *
 * `asOf` is the date stamped on any change. Callers pass the run date; tests
 * pass a fixed one.
 */
export function planCoverageSync(
  watchlist: WatchlistSnapshotEntry[],
  recorded: CoverageDbRow[],
  asOf: string,
): CoveragePlan {
  const live = new Map<string, WatchlistSnapshotEntry>();
  for (const entry of watchlist) {
    const key = brandNormalize(entry.brand);
    // A brand with no primary domain cannot be joined to the monthly stats, so
    // recording it would create a row that can never match anything — and
    // brand_domain is NOT NULL (v297) besides.
    if (!key || !entry.legitimate_domains?.[0]) continue;
    if (!live.has(key)) live.set(key, entry);
  }

  const openKeys = new Set(
    recorded.filter((r) => !r.covered_to).map((r) => r.brand_normalized),
  );

  const toAdd = [...live.entries()]
    .filter(([key]) => !openKeys.has(key))
    .map(([key, entry]) => ({
      brand: entry.brand,
      brand_normalized: key,
      brand_domain: entry.legitimate_domains[0].toLowerCase(),
      covered_from: asOf,
      source: "live",
    }));

  const toClose = [...openKeys].filter((key) => !live.has(key));

  return { toAdd, toClose, unchanged: live.size - toAdd.length };
}

/**
 * Log a coverage change. Rare and load-bearing: a watchlist edit silently
 * invalidates trend comparisons for the affected brands, so it must be visible.
 */
export function logCoverageChange(plan: CoveragePlan, asOf: string): void {
  if (plan.toAdd.length === 0 && plan.toClose.length === 0) return;
  logger.warn("clone-watch: brand coverage changed", {
    added: plan.toAdd.map((r) => r.brand_normalized),
    closed: plan.toClose,
    asOf,
  });
}
