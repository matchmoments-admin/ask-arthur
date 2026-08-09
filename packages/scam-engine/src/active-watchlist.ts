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
 *
 * CACHING — why the fetch and not the result
 * ------------------------------------------
 * Consolidating the read put this function on a hot path. `analyze-checkout`
 * calls it per request, and that route's header states its design premise
 * outright: "LOW-LATENCY by design: no APIVoid / Claude on the hot path". With
 * FF_BRAND_DYNAMIC_WATCHLIST off it returns before touching Supabase, so the
 * cost is zero today — but turning the flag on would add a DB round trip to
 * every checkout scan carrying a brand. That is the kind of quiet latency
 * regression a flag flip is not supposed to include.
 *
 * So the OVERLAY ROWS are cached, not the merged watchlist. Caching the merged
 * result would mean keying on `staticList`, and a caller passing a custom list
 * could be served another caller's merge. Merging is pure and cheap (a copy of
 * ~212 entries and a Set build), so it re-runs per call and the parameter stays
 * honest.
 *
 * Three properties that matter more than the hit rate:
 *   - Only SUCCESSFUL reads are cached. A transient RPC error must not pin the
 *     static list for the whole TTL — the next call retries.
 *   - Single-flight: concurrent callers share one in-flight query rather than
 *     stampeding the RPC when an instance warms up.
 *   - Explicitly invalidatable, so the instance that handled a promotion
 *     serves fresh data on its next read.
 *
 * SCOPE LIMIT, stated because it is easy to overstate: this is an IN-PROCESS
 * cache, so invalidateActiveWatchlistCache() only clears the cache of the
 * serverless instance that runs it. Other instances, other regions, and the
 * Inngest runtime keep their own copy until their own TTL expires. A promotion
 * is therefore visible everywhere within OVERLAY_TTL_MS, not instantly. That
 * is an accepted trade: making it global would need a shared store read on
 * every call, which is the per-request round trip the cache exists to remove.
 * If sub-TTL global consistency is ever required, the shape to reach for is a
 * cheap version token (Redis INCR on write, read-through compare) — not
 * dropping the cache.
 */

/** How long a successful overlay read stays fresh. monitored_brands is a cold
 *  table (a row changes on signup/edit/promotion only), so this trades at most
 *  a minute of staleness for removing a per-request query. Promotions call
 *  invalidateActiveWatchlistCache() and are therefore not subject to it. */
const OVERLAY_TTL_MS = 60_000;

interface OverlayCache {
  fetchedAt: number;
  rows: DynamicBrandEntry[];
}

let cache: OverlayCache | null = null;
/** In-flight read, shared by concurrent callers (single-flight). */
let inFlight: Promise<DynamicBrandEntry[] | null> | null = null;

/**
 * Drop this process's cached overlay so its next read hits the database.
 *
 * Call after ANY write to monitored_brands — promotion, demotion, a customer
 * registering a brand. It narrows the window in which the admin UI and the
 * matcher disagree, but does NOT eliminate it: see the SCOPE LIMIT note above.
 * Other instances converge within OVERLAY_TTL_MS. Also used by tests to
 * isolate cases.
 */
export function invalidateActiveWatchlistCache(): void {
  cache = null;
  inFlight = null;
}

/** Read the overlay rows, cached. Returns null when the read FAILED (as
 *  distinct from succeeding with zero rows) so the caller can tell a genuine
 *  empty overlay from a degraded one. */
async function loadOverlayRows(
  now: number,
): Promise<DynamicBrandEntry[] | null> {
  if (cache && now - cache.fetchedAt < OVERLAY_TTL_MS) return cache.rows;
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<DynamicBrandEntry[] | null> => {
    const sb = createServiceClient();
    if (!sb) return null;

    const { data, error } = await sb.rpc("list_active_monitored_brands");
    if (error) {
      logger.error("active-watchlist: overlay load failed, using static list", {
        error: error.message,
      });
      // Deliberately NOT cached — a blip must not pin the static list for the
      // full TTL while the overlay is healthy again.
      return null;
    }

    const rows = (data as DynamicBrandEntry[] | null) ?? [];
    cache = { fetchedAt: now, rows };
    return rows;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Full result, including rejected overlay rows. Use when you want to report
 *  on what was dropped. */
export async function getActiveWatchlistDetailed(
  staticList: readonly BrandEntry[] = AU_BRAND_WATCHLIST,
): Promise<ActiveWatchlist> {
  const staticOnly: ActiveWatchlist = {
    entries: [...staticList],
    rejected: [],
    dynamicCount: 0,
  };

  if (!featureFlags.brandDynamicWatchlist) return staticOnly;

  const rows = await loadOverlayRows(Date.now());
  if (rows === null || rows.length === 0) return staticOnly;

  const merged = mergeDynamicWatchlist(rows, staticList);

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
