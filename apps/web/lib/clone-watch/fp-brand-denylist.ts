/**
 * Shared false-positive brand denylist for clone-watch.
 *
 * These brand domains are generic dictionary words (e.g. "domain", "lendi"),
 * so the lexical NRD matcher flags far too many unrelated domains as
 * "clones" of them. They were removed from the watchlist (v176), but stale
 * detections linger in shopfront_clone_alerts — so every consumer of clone
 * detections must exclude them too. The single source of truth for the TS
 * side; the SQL RPC list_clone_alerts_pending_netcraft_auto keeps an
 * equivalent literal list (SQL can't import this).
 *
 * Consumers:
 *  - clone-watch-submit-netcraft.ts (never report these to Netcraft)
 *  - report-brand-stewardship.ts (never surface these in the brand digest /
 *    LinkedIn worklist)
 */
export const FP_BRAND_DENYLIST: ReadonlySet<string> = new Set([
  "domain.com.au",
  "allhomes.com.au",
  "lendi.com.au",
]);

/** True if the (brand or inferred-target) domain is a known FP dictionary brand. */
export function isFpBrand(domain: string | null | undefined): boolean {
  if (!domain) return false;
  return FP_BRAND_DENYLIST.has(domain.trim().toLowerCase());
}
