/**
 * Shared brand display-name casing for Clone Watch surfaces (the carousel +
 * the LinkedIn caption). One source of truth so a brand can't be cased two ways
 * across the post — e.g. "HESTA" on the slide but "Hesta" in the caption.
 *
 * `SUPER_FUND_DOMAINS` lives here, beside the casing map, rather than in
 * report-card-data.ts where it was. The two are the same fact about the same
 * brands, and separating them let the lists drift: Australian Retirement Trust
 * and Brighter Super sat in the fund set with no casing override, so a month
 * either one led the spotlight would have published "Australianretirementtrust"
 * and "Brightersuper" on the slide and in the caption alike. Adjacency is a
 * stronger guarantee than a test here — you cannot add a fund without reading
 * the map — and the parity test backs it up.
 */

/** Brands whose display name isn't a naive capitalise-first. */
const BRAND_DISPLAY: Record<string, string> = {
  whatsapp: "WhatsApp",
  paypal: "PayPal",
  hellostake: "Stake",
  aliexpress: "AliExpress",
  fedex: "FedEx",
  shein: "SHEIN",
  iinet: "iiNet",
  ebay: "eBay",
  youtube: "YouTube",
  // AU super funds (proper casing, not capitalise-first)
  hesta: "HESTA",
  australiansuper: "AustralianSuper",
  unisuper: "UniSuper",
  hostplus: "Hostplus",
  aware: "Aware Super",
  cbus: "Cbus",
  rest: "Rest Super",
  caresuper: "CareSuper",
  ngssuper: "NGS Super",
  telstrasuper: "TelstraSuper",
  visionsuper: "Vision Super",
  spiritsuper: "Spirit Super",
  // Both were in SUPER_FUND_DOMAINS with no override here, so a month either
  // one led would have published "Australianretirementtrust" / "Brightersuper"
  // — on the slide AND in the caption, since both go through prettyBrand. The
  // parity test below the fold (cloneWatchBrandDisplay.test.ts) now fails if a
  // fund is added to one list and not the other.
  australianretirementtrust: "Australian Retirement Trust",
  brightersuper: "Brighter Super",
};

/**
 * AU super funds, by the domain key the report card ranks on.
 *
 * Super funds ARE Australian brands even on a `.com` (australiansuper.com),
 * which the `.au` TLD heuristic would call "global" and hide from the
 * spotlight — so the card ranks against AU brands PLUS this set. Every entry
 * needs a casing override above; `superFundsMissingDisplayName()` is the guard.
 */
export const SUPER_FUND_DOMAINS: ReadonlySet<string> = new Set([
  "hesta.com.au",
  "australiansuper.com",
  "aware.com.au",
  "hostplus.com.au",
  "unisuper.com.au",
  "rest.com.au",
  "cbus.com.au",
  "caresuper.com.au",
  "australianretirementtrust.com.au",
  "spiritsuper.com.au",
  "ngssuper.com.au",
  "brightersuper.com.au",
  "telstrasuper.com.au",
  "visionsuper.com.au",
]);

/**
 * Fund domains with no casing override — i.e. ones that would publish as
 * capitalise-first. Empty is the only acceptable value; the test asserts it.
 */
export function superFundsMissingDisplayName(): string[] {
  return [...SUPER_FUND_DOMAINS].filter((domain) => {
    const label = (domain.split(".")[0] ?? domain).toLowerCase();
    return BRAND_DISPLAY[label] === undefined;
  });
}

/** "target.com.au" → "Target"; strips the TLD and applies a display-name
 *  override where naive capitalise-first would look wrong. */
export function prettyBrand(domain: string): string {
  const label = (domain.split(".")[0] ?? domain).toLowerCase();
  return BRAND_DISPLAY[label] ?? label.charAt(0).toUpperCase() + label.slice(1);
}
