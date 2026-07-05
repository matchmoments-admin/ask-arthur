/**
 * Shared brand display-name casing for Clone Watch surfaces (the carousel +
 * the LinkedIn caption). One source of truth so a brand can't be cased two ways
 * across the post — e.g. "HESTA" on the slide but "Hesta" in the caption.
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
};

/** "target.com.au" → "Target"; strips the TLD and applies a display-name
 *  override where naive capitalise-first would look wrong. */
export function prettyBrand(domain: string): string {
  const label = (domain.split(".")[0] ?? domain).toLowerCase();
  return BRAND_DISPLAY[label] ?? label.charAt(0).toUpperCase() + label.slice(1);
}
