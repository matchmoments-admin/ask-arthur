import { getActiveWatchlist } from "@askarthur/scam-engine/active-watchlist";
import { resolveBrandInWatchlist } from "@askarthur/shopfront-glue";
import type { BrandEntry } from "@askarthur/shopfront-glue/au-brand-watchlist";

/**
 * Resolve a user-supplied brand name or domain to a watch-list entry by EXACT
 * set membership — its brand name, an alias, or one of its legitimate domains.
 * Deliberately NO fuzzy / substring / wildcard matching: the whole point is
 * that arbitrary input (e.g. "%%", "a%") can never widen the downstream
 * clone-list query. Returns null for anything not on the watch-list, which the
 * caller treats as an "unmonitored brand" (still a captured lead, but no CSV).
 *
 * The matching logic itself now lives in `resolveBrandInWatchlist`
 * (@askarthur/shopfront-glue) so it can run against ANY watchlist. This module
 * supplies the ACTIVE one — static AU brands plus verified overlay brands —
 * because resolving against the static array alone told a registered customer
 * their own brand was unmonitored.
 */
export async function resolveWatchlistBrand(
  input: string,
): Promise<BrandEntry | null> {
  const watchlist = await getActiveWatchlist();
  return resolveBrandInWatchlist(input, watchlist);
}

// Re-exported so tests and pure callers can resolve against an explicit list
// without touching the database.
export { resolveBrandInWatchlist };
