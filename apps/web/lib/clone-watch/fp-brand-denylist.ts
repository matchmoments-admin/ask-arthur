/**
 * Shared false-positive brand denylist for clone-watch.
 *
 * These brand domains are generic dictionary words (e.g. "domain", "lendi"),
 * so the lexical NRD matcher flags far too many unrelated domains as
 * "clones" of them. They were removed from the watchlist (v176), but stale
 * detections linger in shopfront_clone_alerts — so every consumer of clone
 * detections must exclude them too. The single source of truth for the TS
 * side. SQL can't import this, so two worklist RPCs keep a literal copy —
 * list_clone_alerts_pending_netcraft_auto and _netcraft_issue — and
 * __tests__/fpBrandDenylistSqlDrift.test.ts fails if either one's latest
 * migration definition disagrees with this set. Changing it = edit here AND
 * ship a migration re-creating both functions.
 *
 * Consumers:
 *  - the netcraft-auto worklist (never report these to Netcraft)
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
