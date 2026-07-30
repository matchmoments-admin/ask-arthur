import { describe, expect, it } from "vitest";
import { AU_BRAND_WATCHLIST } from "../au-brand-watchlist";
import { buildWatchedKeySet } from "../active-watchlist";
import { brandNormalize } from "../brand-normalize";

/**
 * GUARD — a watchlist label with a disambiguating suffix must not hide the
 * brand from the "already watched?" gate.
 *
 * THE BUG THIS EXISTS TO PREVENT (v261, found 2026-07-30)
 * ------------------------------------------------------
 * `buildWatchedKeySet` is EXACT set membership on brandNormalize(). An entry
 * labelled "eBay Australia" normalises to `ebayaustralia`, but the upstream
 * classifier only ever emits the plain trading name — `ebay`. The two never
 * match, so a brand we already monitor gets proposed to the operator as a
 * brand-new candidate. eBay was sitting at the TOP of /admin/brand-candidates
 * with AU evidence, looking like the obvious promote, while already covered.
 *
 * It is not one odd label: 16 of 291 entries had an unwatched plain form.
 *
 * WHY THIS TEST IS THE DELIVERABLE, NOT THE DATA FIX
 * --------------------------------------------------
 * Aliasing the twelve affected brands is a one-off. The failure mode is that
 * the NEXT person adds `{ brand: "Kmart (AU)" }` and silently reopens the leak,
 * with the only symptom being a bad row in a review queue nobody reads closely.
 * So this walks EVERY entry and fails until the new label is either bridged or
 * consciously listed below with a reason.
 *
 * WHERE THE BRIDGE LIVES — and why not here
 * -----------------------------------------
 * The fix is a `brand_aliases` row (migration v261), NOT an `aliases` entry on
 * the watchlist object, because `aliases` are LIVE MATCHER TOKENS (see
 * getWatchlistIndex in lexical-match.ts) and that field's own contract requires
 * ">=5 chars and distinctive". Five of the affected plain forms are shorter than
 * that (ebay, kayo, myki, opal, ing), and `ing` as a matcher token would hit any
 * confusable-bearing domain containing "ing" — the confusable path has no length
 * guard. brand_aliases is invisible to the matcher, so it closes the gate with
 * zero matcher risk.
 *
 * Consequence for THIS test: it cannot see the DB, so it asserts the weaker but
 * still load-bearing property — every suffixed label's plain form is either
 * already watched by the static list, or explicitly acknowledged below. The
 * matching DB-side assertion (that the alias actually resolves to a watched key)
 * lives in apps/web/__tests__/redditBrandsDiscoverProdReplay.test.ts, which has
 * the real alias fixture.
 */

/**
 * The bridges migration v261 installs, mirrored here: plain key -> the EXACT
 * watchlist label it must resolve to.
 *
 * Mirroring the migration in a test is usually a smell, but it buys a check the
 * migration cannot make for itself: that every bridge TARGET is a real
 * watchlist label. A row pointing at "Netflix AU" instead of "Netflix (AU)"
 * would apply cleanly, look right in the table, and bridge nothing — the same
 * silent-no-op class as the self-referential rows this migration replaces.
 */
const BRIDGED_IN_BRAND_ALIASES: Record<string, string> = {
  ebay: "eBay Australia",
  netflix: "Netflix (AU)",
  binance: "Binance Australia",
  spotify: "Spotify (AU)",
  disney: "Disney+ (AU)",
  foxtel: "Foxtel / Kayo",
  kayo: "Foxtel / Kayo",
  ing: "ING Australia",
  linkt: "Linkt (Transurban)",
  opal: "Opal (Transport for NSW)",
  translink: "Translink (Queensland)",
  myki: "myki (Public Transport Victoria)",
};

/**
 * Plain forms deliberately NOT bridged, with the reason. Adding to this list is
 * a decision, which is the point — it should be uncomfortable enough to think
 * about, and it leaves a record of why.
 */
const KNOWN_UNBRIDGED: Record<string, string> = {
  // AMBIGUOUS — both "Virgin Australia" and "Virgin Money" are on the watchlist,
  // so bare "Virgin" cannot be resolved mechanically. Operator decision.
  virgin: "ambiguous: Virgin Australia vs Virgin Money",
  // GENERIC WORDS — bridging these would collapse unrelated mentions onto a
  // watched brand, which is worse than the leak they'd close.
  bank: "generic stem of 'Bank Australia'",
  ip: "generic stem of 'IP Australia'",
  services: "generic stem of 'Services Australia'",
  // Malformed stem — the useful alias for this brand is "RBA", not this.
  reservebankof: "malformed stem of 'Reserve Bank of Australia'; use RBA",
};

/**
 * Derive the label(s) an upstream classifier would plausibly emit for a
 * watchlist entry whose official label carries a suffix. Mirrors the three
 * shapes actually present in the list:
 *   "Netflix (AU)"       -> "Netflix"      (trailing parenthetical)
 *   "eBay Australia"     -> "eBay"         (trailing country word)
 *   "Foxtel / Kayo"      -> "Foxtel","Kayo" (either side of a slash)
 */
export function plainFormsOf(label: string): string[] {
  const out = new Set<string>();
  const paren = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (paren !== label && paren) out.add(paren);
  const country = label.replace(/\s+(Australia|AU|Australian)$/, "").trim();
  if (country !== label && country) out.add(country);
  if (label.includes(" / ")) {
    for (const part of label.split(" / ")) {
      const p = part.trim();
      if (p) out.add(p);
    }
  }
  return [...out];
}

describe("watchlist label variants — suffixed labels must not hide a brand", () => {
  const watched = buildWatchedKeySet(AU_BRAND_WATCHLIST);

  it("every suffixed label's plain form is watched, bridged, or excused", () => {
    const leaks: string[] = [];
    for (const entry of AU_BRAND_WATCHLIST) {
      for (const plain of plainFormsOf(entry.brand)) {
        const key = brandNormalize(plain);
        if (!key || watched.has(key)) continue;
        if (key in BRIDGED_IN_BRAND_ALIASES) continue;
        if (key in KNOWN_UNBRIDGED) continue;
        leaks.push(`${entry.brand} -> "${plain}" (${key})`);
      }
    }
    // If this fails, a watchlist entry carries a suffix the classifier will
    // never emit. Fix it with a brand_aliases row mapping the plain key to this
    // exact label (see migration v261 for the shape) — NOT with an `aliases`
    // entry, which would add a matcher token. If it genuinely cannot be bridged
    // (generic or ambiguous), add it to KNOWN_UNBRIDGED with the reason.
    expect(leaks).toEqual([]);
  });

  it("every bridge points at a REAL watchlist label", () => {
    // The check the migration cannot make for itself. A canonical_brand of
    // "Netflix AU" instead of "Netflix (AU)" applies cleanly, reads plausibly in
    // the table, and bridges nothing — silently leaving the leak open. Catching
    // that needs the watchlist in hand, which is here.
    const labels = new Set(
      AU_BRAND_WATCHLIST.map((e) => brandNormalize(e.brand)).filter(Boolean),
    );
    for (const [plainKey, target] of Object.entries(BRIDGED_IN_BRAND_ALIASES)) {
      const targetKey = brandNormalize(target);
      expect(
        targetKey && labels.has(targetKey),
        `v261 bridges ${plainKey} -> ${JSON.stringify(target)}, which is not a watchlist label`,
      ).toBe(true);
    }
  });

  it("no bridge is self-referential — the bug v261 exists to correct", () => {
    // Before v261 the rows read `ebay -> "eBay"`, `netflix -> "Netflix"`,
    // `binance -> "Binance"`. Each normalises straight back to the UNWATCHED
    // key, so it satisfies "an alias exists" while bridging nothing. That is
    // why the migration is an UPSERT rather than ON CONFLICT DO NOTHING.
    for (const [plainKey, target] of Object.entries(BRIDGED_IN_BRAND_ALIASES)) {
      expect(
        brandNormalize(target),
        `${plainKey} resolves back to itself — it bridges nothing`,
      ).not.toBe(plainKey);
    }
  });

  it("the exclusion list is live — every entry still corresponds to a real label", () => {
    // Stops KNOWN_UNBRIDGED rotting into a list of keys nobody can trace back
    // to a watchlist entry, which is how exception lists become permanent.
    const allPlainKeys = new Set(
      AU_BRAND_WATCHLIST.flatMap((e) =>
        plainFormsOf(e.brand).map((p) => brandNormalize(p)),
      ).filter(Boolean) as string[],
    );
    for (const key of Object.keys(KNOWN_UNBRIDGED)) {
      expect(allPlainKeys, `${key} no longer derives from any watchlist label`)
        .toContain(key);
    }
  });

  it("plainFormsOf handles the three suffix shapes actually in the list", () => {
    expect(plainFormsOf("Netflix (AU)")).toContain("Netflix");
    expect(plainFormsOf("eBay Australia")).toContain("eBay");
    expect(plainFormsOf("Foxtel / Kayo")).toEqual(
      expect.arrayContaining(["Foxtel", "Kayo"]),
    );
    // No suffix -> nothing to bridge.
    expect(plainFormsOf("Bunnings")).toEqual([]);
  });

  it("the guard can actually fail — a new suffixed brand is caught", () => {
    // A guard that cannot fail is not a guard. This proves the detection logic
    // fires on the exact shape someone will add next.
    const withNew = [
      ...AU_BRAND_WATCHLIST,
      // Deliberately a brand NOT already on the list. The first draft used
      // "Kmart (AU)" and this test failed — because plain "Kmart" is already a
      // watchlist entry, so the guard correctly saw no leak. The guard caught a
      // bad fixture before the fixture could vouch for a broken guard.
      { brand: "Zalando (AU)", legitimate_domains: ["zalando.com.au"] },
    ];
    const w = buildWatchedKeySet(withNew);
    const leaks: string[] = [];
    for (const entry of withNew) {
      for (const plain of plainFormsOf(entry.brand)) {
        const key = brandNormalize(plain);
        if (!key || w.has(key)) continue;
        if (key in BRIDGED_IN_BRAND_ALIASES || key in KNOWN_UNBRIDGED) continue;
        leaks.push(key);
      }
    }
    expect(leaks).toContain("zalando");
  });
});
