// Registrar / host abuse-report channel lookup for the Brand Stewardship
// Report's clone-watch section.
//
// The monthly summary lists lookalike domains with the registrar + (where
// captured) the registrar's abuse email. This module adds a *link* to the
// registrar's public abuse-report channel so a brand's team can act in one
// click — and so the aggregate (e.g. "5 clones registered via GoDaddy")
// becomes a clickable accountability signal pointing back at the registrar.
//
// Honesty/robustness: we only hard-code abuse URLs we're confident are stable
// and authoritative. For everything else we return null and the caller falls
// back to (a) the per-domain registrar abuse email (WHOIS-captured) and/or
// (b) the universal ICANN complaint form. So every clone is always actionable,
// and we never link to a guessed/stale URL.

/** Universal fallback — ICANN's registrar-complaint intake. Always valid. */
export const ICANN_COMPLAINT_URL = "https://www.icann.org/compliance/complaint";

/**
 * Known registrar abuse-report pages, keyed by a normalised registrar token.
 * Matched by substring against the normalised WHOIS registrar string so the
 * many surface forms ("GoDaddy.com, LLC", "GoDaddy.com LLC") all resolve.
 *
 * URLs verified live 2026-06-15. Note: Namecheap / NameSilo / Dynadot /
 * Cloudflare return 403 to scripted `curl` (bot/WAF) but resolve fine in a
 * browser — these are the canonical abuse pages. Anything we're NOT confident
 * about is omitted and falls back to the per-domain WHOIS abuse email +
 * ICANN_COMPLAINT_URL (e.g. Google Domains, now defunct/migrated to Squarespace
 * with no clean abuse URL, is deliberately not listed).
 */
const REGISTRAR_ABUSE_URLS: ReadonlyArray<{ match: string; url: string }> = [
  { match: "godaddy", url: "https://supportcenter.godaddy.com/AbuseReport" },
  { match: "namecheap", url: "https://www.namecheap.com/legal/abuse-policy/report-abuse/" },
  { match: "namesilo", url: "https://www.namesilo.com/Support/Report-Abuse" },
  { match: "dynadot", url: "https://www.dynadot.com/report-abuse" },
  { match: "hostinger", url: "https://www.hostinger.com/legal/abuse-policy" },
  // Cloudflare is both a registrar AND a common reverse-proxy host — one form
  // covers both. See hostAbuseUrl() for the hosting-side use.
  { match: "cloudflare", url: "https://abuse.cloudflare.com/" },
  { match: "porkbun", url: "https://porkbun.com/abuse" },
  { match: "tucows", url: "https://tucowsdomains.com/report-abuse/" },
];

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Best abuse-report URL for a domain given its WHOIS registrar string.
 * Returns a registrar-specific URL when we know one, else null (caller falls
 * back to the registrar abuse email and/or ICANN_COMPLAINT_URL).
 */
export function registrarAbuseUrl(
  registrar: string | null | undefined,
): string | null {
  if (!registrar) return null;
  const n = normalise(registrar);
  for (const { match, url } of REGISTRAR_ABUSE_URLS) {
    if (n.includes(match)) return url;
  }
  return null;
}

/** Cloudflare ASN (covers AS13335). Other Cloudflare-owned ranges share it. */
const CLOUDFLARE_ASNS = new Set(["AS13335", "13335"]);

/**
 * Hosting-side abuse channel from the ASN, where we know a self-serve form.
 * Today only Cloudflare (the dominant reverse-proxy in the clone data) has a
 * clean public form; everything else returns null. Kept separate from the
 * registrar channel because "where it's hosted" and "who registered it" are
 * two different takedown levers a brand can pull.
 */
export function hostAbuseUrl(asn: string | null | undefined): string | null {
  if (!asn) return null;
  const a = asn.toUpperCase().replace(/\s+/g, "");
  if (CLOUDFLARE_ASNS.has(a)) return "https://abuse.cloudflare.com/";
  return null;
}
