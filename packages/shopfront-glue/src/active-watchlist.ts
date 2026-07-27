// The active clone-watch watchlist = the static AU brand array plus any
// dynamically-registered brands, merged and validated in one place.
//
// WHY THIS EXISTS
// ---------------
// The static list (au-brand-watchlist.ts) is compile-time. v207 added
// monitored_brands as a runtime overlay for paid Brand Monitor + pilot
// customers, and shopfront-nrd-daily-ingest merged it privately. Only the NRD
// matcher saw the merged list; every OTHER reader still went straight to
// AU_BRAND_WATCHLIST:
//
//   - reddit-brands-discover's "already watched?" gate
//   - lib/clone-watch/resolve-brand.ts
//   - api/extension/analyze-checkout
//   - brand-register-refresh
//
// That split is a starvation trap of the exact shape the 2026-07-12 clone-watch
// incident taught: a brand promoted into the overlay IS matched by the NRD
// sweep, but the discovery cron still sees it as unwatched and re-announces it
// as a "new brand" every week, forever. A write that doesn't move a row across
// the predicate its consumer filters on is a silent no-op. Consolidating the
// read is what makes promotion safe to automate at all.
//
// The merge is pure so it can be tested exhaustively; the DB fetch lives in
// the Adapter (@askarthur/scam-engine/active-watchlist), which keeps this
// package free of a supabase dependency.

import { AU_BRAND_WATCHLIST, type BrandEntry } from "./au-brand-watchlist";
import { brandNormalize } from "./brand-normalize";

/** A row from the runtime overlay, in the shape the RPC returns. Fields are
 *  nullable because the table's arrays default to '{}' and the RPC does not
 *  guarantee them. */
export interface DynamicBrandEntry {
  brand: string;
  legitimate_domains?: string[] | null;
  aliases?: string[] | null;
}

export type WatchlistRejectReason =
  /** No legitimate domains → the matcher would have no exclusion list. */
  | "no_domains"
  /** Brand name normalises to nothing (empty / symbols only). */
  | "unnormalisable"
  /** Already covered by the static list or an earlier dynamic row. */
  | "duplicate";

export interface WatchlistRejection {
  brand: string;
  reason: WatchlistRejectReason;
}

export interface ActiveWatchlist {
  entries: BrandEntry[];
  /** Dynamic rows that did NOT make it in. Callers should log these — a brand
   *  someone registered and expects to be monitored, silently dropped, is a
   *  support ticket waiting to happen. */
  rejected: WatchlistRejection[];
  /** How many of `entries` came from the overlay rather than the static list. */
  dynamicCount: number;
}

/** Trim, lowercase, strip scheme/www/path. A domain list is only useful to the
 *  matcher in a canonical form. */
function normaliseDomain(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

/**
 * Merge dynamically-registered brands into the static watchlist.
 *
 * Rules, in order:
 *
 *  1. The static list always wins. A dynamic row for a brand already on it is
 *     dropped as a duplicate rather than overriding curated domains/aliases.
 *  2. A dynamic row with NO usable legitimate domain is REJECTED, never
 *     merged with an empty array. `legitimate_domains` is the matcher's
 *     EXCLUSION list: a brand with an empty one matches its own website and
 *     reports it as a clone of itself. The v207 table permits '{}' (its
 *     default) and the original merge did `?? []`, so this was reachable.
 *  3. Duplicates within the dynamic set collapse to the first occurrence.
 *
 * Pure and total — no throwing, no I/O. Every dropped row comes back in
 * `rejected` with a reason.
 */
export function mergeDynamicWatchlist(
  dynamic: readonly DynamicBrandEntry[],
  staticList: readonly BrandEntry[] = AU_BRAND_WATCHLIST,
): ActiveWatchlist {
  const entries: BrandEntry[] = [...staticList];
  const rejected: WatchlistRejection[] = [];
  const seen = new Set<string>();

  for (const e of staticList) {
    const k = brandNormalize(e.brand);
    if (k) seen.add(k);
  }

  let dynamicCount = 0;
  for (const d of dynamic) {
    const key = brandNormalize(d.brand);
    if (!key) {
      rejected.push({ brand: d.brand, reason: "unnormalisable" });
      continue;
    }
    if (seen.has(key)) {
      rejected.push({ brand: d.brand, reason: "duplicate" });
      continue;
    }

    const domains = (d.legitimate_domains ?? [])
      .map(normaliseDomain)
      .filter((x) => x.length > 0);
    if (domains.length === 0) {
      // The single most important guard in this file.
      rejected.push({ brand: d.brand, reason: "no_domains" });
      continue;
    }

    seen.add(key);
    dynamicCount += 1;
    entries.push({
      brand: d.brand,
      legitimate_domains: domains,
      aliases: (d.aliases ?? []).filter((a) => a.trim().length > 0),
    });
  }

  return { entries, rejected, dynamicCount };
}

/**
 * The set of normalised keys a watchlist already covers — canonical brand
 * names AND aliases.
 *
 * This is the "already watched?" predicate. It MUST be fed the active
 * watchlist, not the static array: fed the static array while promotion writes
 * to the overlay, a promoted brand stays permanently invisible to it and gets
 * re-surfaced as a new candidate on every run.
 */
export function buildWatchedKeySet(
  watchlist: ReadonlyArray<{ brand: string; aliases?: string[] }>,
): Set<string> {
  const set = new Set<string>();
  for (const entry of watchlist) {
    const b = brandNormalize(entry.brand);
    if (b) set.add(b);
    for (const alias of entry.aliases ?? []) {
      const a = brandNormalize(alias);
      if (a) set.add(a);
    }
  }
  return set;
}

/**
 * Resolve a user-supplied brand name or domain to a watchlist entry by EXACT
 * set membership — its brand name, an alias, or one of its legitimate domains.
 *
 * Deliberately NO fuzzy / substring / wildcard matching: the whole point is
 * that arbitrary input (e.g. "%%", "a%") can never widen a downstream
 * clone-list query. Returns null for anything not on the list, which callers
 * treat as an "unmonitored brand".
 */
export function resolveBrandInWatchlist(
  input: string,
  watchlist: readonly BrandEntry[] = AU_BRAND_WATCHLIST,
): BrandEntry | null {
  const d = normaliseDomain(input);
  const n = brandNormalize(input);
  if (!d && !n) return null;
  for (const e of watchlist) {
    if (e.legitimate_domains.some((dom) => normaliseDomain(dom) === d)) return e;
    if (brandNormalize(e.brand) === n) return e;
    if (e.aliases?.some((a) => brandNormalize(a) === n)) return e;
  }
  return null;
}
