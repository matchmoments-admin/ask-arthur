import {
  AU_BRAND_WATCHLIST,
  mergeDynamicWatchlist,
  type ActiveWatchlist,
  type BrandEntry,
  type DynamicBrandEntry,
} from "@askarthur/shopfront-glue";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

/**
 * The ONE reader of the active clone-watch watchlist.
 *
 * Before this, `buildActiveWatchlist()` was private to
 * shopfront-nrd-daily-ingest, so only the NRD matcher saw the
 * static-plus-overlay list. Everything else — the discovery cron's
 * already-watched gate, resolve-brand, analyze-checkout, brand-register —
 * read AU_BRAND_WATCHLIST directly and was blind to any registered brand.
 *
 * That divergence is the reason promotion could not be automated: a brand
 * written to the overlay would be matched by the sweep and simultaneously
 * re-announced as an unwatched "new brand" by the discovery digest every
 * single week, because the two stages disagreed about what "watched" means.
 *
 * Fails SAFE in every direction — flag off, no client, RPC error, or zero rows
 * all return exactly the static list, so the matcher's behaviour is unchanged
 * rather than empty. An overlay that fails to load must never be able to
 * silently shrink the watchlist.
 */

/** Full result, including rejected overlay rows. Use when you want to report
 *  on what was dropped. */
export async function getActiveWatchlistDetailed(
  staticList: readonly BrandEntry[] = AU_BRAND_WATCHLIST,
): Promise<ActiveWatchlist> {
  const empty: ActiveWatchlist = {
    entries: [...staticList],
    rejected: [],
    dynamicCount: 0,
  };

  if (!featureFlags.brandDynamicWatchlist) return empty;

  const sb = createServiceClient();
  if (!sb) return empty;

  const { data, error } = await sb.rpc("list_active_monitored_brands");
  if (error) {
    // Degrade to the static list rather than throwing: a clone sweep that runs
    // against ~212 curated brands is far better than one that doesn't run.
    logger.error("active-watchlist: overlay load failed, using static list", {
      error: error.message,
    });
    return empty;
  }

  const dynamic = (data as DynamicBrandEntry[] | null) ?? [];
  if (dynamic.length === 0) return empty;

  const merged = mergeDynamicWatchlist(dynamic, staticList);

  // A registered brand that silently fails to be monitored is worse than one
  // that was never registered — the operator believes it is covered. Warn
  // (always-ship level) rather than info-log.
  if (merged.rejected.length > 0) {
    logger.warn("active-watchlist: overlay rows rejected", {
      count: merged.rejected.length,
      rejected: merged.rejected.slice(0, 20),
    });
  }

  return merged;
}

/** The active watchlist entries. The common case — most callers only need the
 *  list, not the rejection detail. */
export async function getActiveWatchlist(
  staticList: readonly BrandEntry[] = AU_BRAND_WATCHLIST,
): Promise<BrandEntry[]> {
  return (await getActiveWatchlistDetailed(staticList)).entries;
}
