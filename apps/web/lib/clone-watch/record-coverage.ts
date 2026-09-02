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
 */
import { brandNormalize } from "@askarthur/shopfront-glue";
import { logger } from "@askarthur/utils/logger";

interface CoverageDbRow {
  brand_normalized: string;
  covered_to: string | null;
}

/** Minimal client surface, so this stays unit-testable without a live DB. */
export interface CoverageStore {
  listOpen(): Promise<CoverageDbRow[]>;
  insert(
    rows: Array<{
      brand: string;
      brand_normalized: string;
      brand_domain: string;
      covered_from: string;
      source: string;
    }>,
  ): Promise<void>;
  close(brandKeys: string[], coveredTo: string): Promise<void>;
}

export interface WatchlistSnapshotEntry {
  brand: string;
  legitimate_domains: string[];
}

export interface CoverageSyncResult {
  added: number;
  closed: number;
  unchanged: number;
}

/**
 * Reconcile the recorded coverage against the live watchlist.
 *
 * `asOf` is the date stamped on any change. Callers pass the run date; tests
 * pass a fixed one.
 */
export async function syncBrandCoverage(
  store: CoverageStore,
  watchlist: WatchlistSnapshotEntry[],
  asOf: string,
): Promise<CoverageSyncResult> {
  const live = new Map<string, WatchlistSnapshotEntry>();
  for (const entry of watchlist) {
    const key = brandNormalize(entry.brand);
    // A brand with no primary domain cannot be joined to the monthly stats, so
    // recording it would create a row that can never match anything.
    if (!key || !entry.legitimate_domains?.[0]) continue;
    if (!live.has(key)) live.set(key, entry);
  }

  const recorded = await store.listOpen();
  const openKeys = new Set(recorded.filter((r) => !r.covered_to).map((r) => r.brand_normalized));

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

  if (toAdd.length > 0) await store.insert(toAdd);
  if (toClose.length > 0) await store.close(toClose, asOf);

  if (toAdd.length > 0 || toClose.length > 0) {
    // Rare and load-bearing: a watchlist change silently invalidates trend
    // comparisons for the affected brands, so it must be visible in the log.
    logger.warn("clone-watch: brand coverage changed", {
      added: toAdd.map((r) => r.brand_normalized),
      closed: toClose,
      asOf,
    });
  }

  return {
    added: toAdd.length,
    closed: toClose.length,
    unchanged: live.size - toAdd.length,
  };
}
