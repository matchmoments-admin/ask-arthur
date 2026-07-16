import type { UrlscanSearchHit } from "@askarthur/scam-engine/urlscan-search";

/**
 * attribution.kit_siblings — other sites urlscan has seen on the SAME hosting
 * IP as a confirmed phishing clone. A phishing kit is typically deployed many
 * times on one host, so siblings are strong "same actor" evidence and feed the
 * campaign-fingerprint clustering.
 */
export interface KitSiblingsBlock {
  pivot: "ip";
  pivot_value: string;
  siblings: Array<{ domain: string; last_seen: string | null }>;
  result_count: number;
  searched_at: string;
}

const MAX_SIBLINGS = 20;

/**
 * Shape a urlscan search result set into the stored block. ALWAYS returns a
 * block (even with zero siblings) so the row crosses the
 * `attribution->'kit_siblings' IS NULL` predicate and is never re-searched
 * (the op-review "move the row across the consume predicate" rule). Excludes
 * the clone domain itself and dedups by domain.
 */
export function shapeKitSiblings(
  selfDomain: string,
  pivotIp: string,
  hits: UrlscanSearchHit[],
  now: Date = new Date(),
): KitSiblingsBlock {
  const self = selfDomain.toLowerCase();
  const seen = new Set<string>();
  const siblings: KitSiblingsBlock["siblings"] = [];
  for (const h of hits) {
    const domain = h.domain?.toLowerCase();
    if (!domain || domain === self || seen.has(domain)) continue;
    seen.add(domain);
    siblings.push({ domain, last_seen: h.lastSeen });
    if (siblings.length >= MAX_SIBLINGS) break;
  }
  return {
    pivot: "ip",
    pivot_value: pivotIp,
    siblings,
    result_count: hits.length,
    searched_at: now.toISOString(),
  };
}
