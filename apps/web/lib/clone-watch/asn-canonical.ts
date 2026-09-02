/**
 * ASN folding + reverse-proxy detection for hosting claims (#1075).
 *
 * "Hosted in X" is only true if X is where the SERVER is. For anything behind a
 * reverse proxy the recorded ASN and country are the CDN's nearest edge, not
 * the operator's infrastructure — so publishing them as a location is wrong in
 * a way that reads as precise.
 *
 * Measured on the August 2026 cohort (1,032 alerts):
 *   attributed with any ASN     542  (53%)
 *   ...of which reverse-proxied 258  (AS13335 Cloudflare alone is 183, and 133
 *                                     of those carry NO country at all)
 *   ...real origin visible      284  (27.5% of the month)
 *
 * So a country claim rests on ~a quarter of the cohort. That is publishable
 * only alongside its denominators, which is why `hostingConcentration` returns
 * `frontedN` and `unattributedN` rather than quietly dropping them.
 *
 * Mirrors registrar-canonical.ts: fold spellings, name the unknown bucket, keep
 * the judgement in one place.
 */

/**
 * Reverse proxies / CDNs: the origin sits BEHIND these, so their ASN tells us
 * nothing about where the clone is really hosted.
 *
 * Deliberately excludes plain hosting providers (AWS, OVH, Hetzner, Hostinger,
 * DigitalOcean). A box in AWS really is in AWS — that is a location, even if a
 * cheap and disposable one. Only proxies hide the origin.
 */
const FRONTING_ASNS = new Map<string, string>([
  ["AS13335", "Cloudflare"],
  ["AS209242", "Cloudflare"],
  ["AS20940", "Akamai"],
  ["AS16625", "Akamai"],
  ["AS54113", "Fastly"],
  ["AS15169", "Google (LB/edge)"],
  ["AS8075", "Microsoft (edge)"],
  ["AS16509", "Amazon CloudFront/edge"],
]);

/** Known operators, for readable output. Extend as the tail justifies it. */
const ASN_NAMES = new Map<string, string>([
  ["AS13335", "Cloudflare"],
  ["AS16509", "Amazon"],
  ["AS20940", "Akamai"],
  ["AS16625", "Akamai"],
  ["AS54113", "Fastly"],
  ["AS15169", "Google"],
  ["AS8075", "Microsoft"],
  ["AS47583", "Hostinger"],
  ["AS24940", "Hetzner"],
  ["AS16276", "OVH"],
  ["AS14061", "DigitalOcean"],
  ["AS200019", "Alexhost"],
  ["AS51167", "Contabo"],
]);

export const UNKNOWN_ASN = "Unknown";

/** `as13335`, `13335`, `AS13335 ` → `AS13335`. Null when unparseable. */
export function canonicalAsn(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  const m = /^(?:AS)?(\d+)$/.exec(s);
  return m ? `AS${m[1]}` : null;
}

/**
 * Does this ASN hide the origin?
 *
 * Note AS16509 (Amazon) is listed as fronting: in this dataset it is dominated
 * by CloudFront edges rather than EC2 origins, and we cannot tell them apart
 * from the ASN alone. Fail toward "we cannot claim a location" rather than
 * toward a confident wrong one.
 */
export function isFrontingAsn(asn: string | null | undefined): boolean {
  const c = canonicalAsn(asn);
  return c !== null && FRONTING_ASNS.has(c);
}

/** Human label for an ASN — the operator name when known, else the ASN. */
export function asnLabel(asn: string | null | undefined): string {
  const c = canonicalAsn(asn);
  if (!c) return UNKNOWN_ASN;
  return ASN_NAMES.get(c) ?? c;
}
