import { AU_BRAND_WATCHLIST, brandNormalize } from "@askarthur/shopfront-glue";
import type { BrandEntry } from "@askarthur/shopfront-glue/au-brand-watchlist";

function normDomain(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

/**
 * Resolve a user-supplied brand name or domain to a watch-list entry by EXACT
 * set membership — its brand name, an alias, or one of its legitimate domains.
 * Deliberately NO fuzzy / substring / wildcard matching: the whole point is
 * that arbitrary input (e.g. "%%", "a%") can never widen the downstream
 * clone-list query. Returns null for anything not on the watch-list, which the
 * caller treats as an "unmonitored brand" (still a captured lead, but no CSV).
 */
export function resolveWatchlistBrand(input: string): BrandEntry | null {
  const d = normDomain(input);
  const n = brandNormalize(input);
  if (!d && !n) return null;
  for (const e of AU_BRAND_WATCHLIST) {
    if (e.legitimate_domains.some((dom) => normDomain(dom) === d)) return e;
    if (brandNormalize(e.brand) === n) return e;
    if (e.aliases?.some((a) => brandNormalize(a) === n)) return e;
  }
  return null;
}
