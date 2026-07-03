/**
 * Registrar-name canonicalisation for clone-watch reporting surfaces.
 *
 * WHOIS registrar strings in `shopfront_clone_alerts.attribution->whois->registrar`
 * are un-normalised: the same vendor appears under several legal-entity spellings
 * ("NAMECHEAP INC" vs "NameCheap, Inc."; "Dynadot LLC" vs "Dynadot Inc"). Any
 * public leaderboard that ranks by registrar MUST fold these together first, or
 * a single vendor gets split across rows and under-counted.
 *
 * Separately, ~45% of rows have a null/redacted registrar which the shared
 * aggregator buckets as "Unknown". Public rankings drop that bucket (it's a
 * data gap, not a registrar) — `rollupRegistrars` excludes it.
 *
 * Single source of truth for the canonical display name; consumed by the
 * report-card data layer (and any future public registrar surface).
 */

/** The shared aggregator's null/empty-registrar bucket key. */
const UNKNOWN_BUCKET = "Unknown";

/**
 * Ordered substring rules. First match wins; matched case-insensitively against
 * the raw registrar string. Keep the big families that actually recur in the
 * clone data at the top — the long tail falls through to a trimmed passthrough.
 */
const CANONICAL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/namecheap/i, "NameCheap"],
  [/dynadot/i, "Dynadot"],
  [/godaddy/i, "GoDaddy"],
  [/namesilo/i, "NameSilo"],
  [/gmo|onamae/i, "GMO Internet (Onamae)"],
  [/spaceship/i, "Spaceship"],
  [/porkbun/i, "Porkbun"],
  [/tucows/i, "Tucows"],
  [/hostinger/i, "Hostinger"],
  [/cloudflare/i, "Cloudflare"],
  [/gname/i, "Gname"],
  [/ionos/i, "IONOS"],
  [/publicdomainregistry|pdr ltd/i, "PDR (PublicDomainRegistry)"],
  [/enom/i, "eNom"],
  [/squarespace/i, "Squarespace"],
  [/network ?solutions/i, "Network Solutions"],
  [/name\.com/i, "Name.com"],
  [/hosting concepts|openprovider/i, "Openprovider"],
  [/nicenic/i, "NiceNIC"],
];

/**
 * Map a raw WHOIS registrar string to its canonical display name.
 * Returns `null` for the "Unknown"/empty bucket (callers drop it from rankings).
 */
export function canonicalRegistrar(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === UNKNOWN_BUCKET) return null;
  for (const [re, name] of CANONICAL_RULES) {
    if (re.test(s)) return name;
  }
  // Long tail: strip common corporate suffixes for a tidier label, else passthrough.
  return s.replace(/,?\s+(inc\.?|llc|ltd\.?|limited|co\.?|gmbh|s\.?a\.?|pty ltd|b\.?v\.?)\.?$/i, "").trim() || s;
}

/**
 * Fold a raw registrar→count map (as produced by `buildRegistrarRollup` / the
 * shared aggregator's `byRegistrar`) into a canonicalised, NULL-excluded,
 * descending leaderboard.
 */
export function rollupRegistrars(
  rawCounts: Record<string, number> | Array<{ registrar: string; clones: number }>,
): Array<{ registrar: string; clones: number }> {
  const entries: Array<[string, number]> = Array.isArray(rawCounts)
    ? rawCounts.map((r) => [r.registrar, r.clones])
    : Object.entries(rawCounts);

  const merged = new Map<string, number>();
  for (const [raw, n] of entries) {
    const name = canonicalRegistrar(raw);
    if (!name) continue; // drop Unknown / redacted
    merged.set(name, (merged.get(name) ?? 0) + n);
  }
  return [...merged.entries()]
    .map(([registrar, clones]) => ({ registrar, clones }))
    .sort((a, b) => b.clones - a.clones || a.registrar.localeCompare(b.registrar));
}
