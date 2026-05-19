// Shop Signal — Stage 0 of Shop Guard. Pure (no I/O, no external calls)
// commerce-page detector + post-processor that filters Claude's existing
// red-flag list for commerce-specific signals. Stage 0 deliberately ships
// without a prompt fork: the system prompt in claude.ts already covers the
// Australian commerce-scam patterns (PayID, "relative will collect",
// .com.au domain renewal, stock-photo product images), so we extract
// signal from what Claude already produces. If the 30-day measurement
// window shows the extracted-flag rate is too low, Stage 0.5 adds a
// commerce-specific prompt addendum.
//
// Plan: docs/plans/shop-guard-v2.md §3 (Stage 0 scope).
// Sibling Module: charity-intent.ts (same shape — pure detector + payload).
//
// Out of scope at Stage 0:
//   - APIVoid Site Trustworthiness call (Stage 1)
//   - RDAP domain-age + ABR ABN Lookup adapters (Stage 1)
//   - infrastructure-cluster join against scam_entities (Stage 1)
//
// Stage 0.5 added: optional referrerSource (the in-app-browser the user
// arrived from — instagram-inapp / tiktok-inapp / facebook-inapp /
// whatsapp-inapp) so the measurement window can count mobile-share share
// of commerce-flagged volume. Detection lives in
// apps/web/app/share-target/route.ts; this Module just carries the value
// through onto the ShopSignal payload.

import type { ReferrerSource } from "@askarthur/types";

const COMMERCE_TLDS = new Set([
  "shop",
  "store",
  "top",
  "online",
  "deals",
  "sale",
  "boutique",
]);

const COMMERCE_PATH_HINTS = [
  "/cart",
  "/checkout",
  "/product/",
  "/products/",
  "/shop/",
  "/store/",
  "/collections/",
];

const PLATFORM_HINTS_IN_URL = [
  "shopify",
  "woocommerce",
  "bigcommerce",
  "sellvia",
];

const COMMERCE_TEXT_VERBS = [
  "add to cart",
  "buy now",
  "checkout",
  "free shipping",
  "limited stock",
  "while stocks last",
  "% off",
  "closing down sale",
  "clearance sale",
  "shop now",
];

// Patterns Claude already produces for commerce-shaped scams (the system
// prompt in claude.ts §"AUSTRALIAN SCAM PATTERNS" + §"FACEBOOK MARKETPLACE
// & PAYID SCAMS" surfaces these). Each entry is a lowercase substring
// matched against an existing red-flag string. Hits get promoted to
// shopSignal.commerceFlags as a normalised tag.
const COMMERCE_FLAG_TAXONOMY: Array<{ tag: string; matches: string[] }> = [
  { tag: "payid-scam", matches: ["payid"] },
  { tag: "fake-payment-confirmation", matches: ["fake payment", "fake confirmation", "payment confirmation", "payid confirmation"] },
  { tag: "overpayment-refund", matches: ["overpayment", "overpaid"] },
  { tag: "off-platform-move", matches: ["whatsapp", "off-platform", "off platform", "messenger", "move communication"] },
  { tag: "relative-will-collect", matches: ["relative will collect", "friend will collect", "send a relative", "send a friend"] },
  { tag: "implausible-discount", matches: ["too-good-to-be-true", "too good to be true", "implausible price", "unrealistic discount"] },
  { tag: "domain-renewal-invoice", matches: ["domain renewal", "domain invoice", ".com.au renewal"] },
  { tag: "stock-photo-product", matches: ["stock photo", "stock image"] },
  { tag: "fake-trust-badge", matches: ["trust badge", "fake badge", "trusted store badge"] },
  { tag: "fake-australia-post", matches: ["australia post", "auspost", "auspost.com.au"] },
  { tag: "urgent-purchase-pressure", matches: ["first to deposit", "first to pay", "deposit can pick", "limited stock", "while stocks last"] },
  { tag: "fake-reviews", matches: ["fake reviews", "fake review", "uniformly 5-star", "generic reviews"] },
];

/**
 * Detect whether the submission looks commerce-shaped. Returns true when
 * the URL OR the text carries at least one commerce hint. Designed to be
 * cheap (no network, just substring checks) and side-effect-free so it's
 * safe to call on every /api/analyze + runAnalysisCore request.
 *
 * urls is the extracted URL list (typically from extractURLs(text)); the
 * caller passes whatever it already has. Stage 0 only needs the hostname
 * + path; a missing list is fine — the text-side check still runs.
 */
export function detectCommerceSignal(
  text: string | null | undefined,
  urls?: string[] | null,
): boolean {
  // URL-side signal: TLD, path, or platform hint.
  if (urls && urls.length > 0) {
    for (const raw of urls) {
      const lower = raw.toLowerCase();
      try {
        // Best-effort parse — extractURLs already validated shape, but
        // protocol-less inputs ("example.shop") slip through.
        const url = new URL(lower.startsWith("http") ? lower : `https://${lower}`);
        const host = url.hostname;
        const path = url.pathname;
        const tld = host.split(".").pop();
        if (tld && COMMERCE_TLDS.has(tld)) return true;
        for (const hint of COMMERCE_PATH_HINTS) {
          if (path.includes(hint)) return true;
        }
        for (const platform of PLATFORM_HINTS_IN_URL) {
          if (host.includes(platform)) return true;
        }
      } catch {
        // ignored — malformed URL
      }
    }
  }

  // Text-side signal: commerce verbs / patterns.
  if (text) {
    const lower = text.toLowerCase();
    for (const verb of COMMERCE_TEXT_VERBS) {
      if (lower.includes(verb)) return true;
    }
  }

  return false;
}

/**
 * Extract commerce-specific tags from a list of Claude-produced red flags.
 * Returns the deduplicated tag set. Empty array when no commerce-shaped
 * flag matched — caller decides whether to still emit a ShopSignal
 * (typically yes, with commerceFlags: [], so downstream surfaces can
 * count "commerce detected but no specific flag" as its own signal).
 */
export function extractCommerceFlags(redFlags: readonly string[]): string[] {
  if (redFlags.length === 0) return [];
  const matched = new Set<string>();
  for (const flag of redFlags) {
    const lower = flag.toLowerCase();
    for (const { tag, matches } of COMMERCE_FLAG_TAXONOMY) {
      if (matched.has(tag)) continue;
      for (const m of matches) {
        if (lower.includes(m)) {
          matched.add(tag);
          break;
        }
      }
    }
  }
  return Array.from(matched);
}

/**
 * Build a ShopSignal payload from the inputs available at the analyze
 * pipeline's signal-merge step. Caller is expected to have already
 * verified `detectCommerceSignal()` is true; this function does NOT
 * re-check (it would be wasted work — the caller has the data).
 *
 * `referrerSource` is the in-app-browser the user arrived from when
 * they came in via the Web Share Target route; undefined when the
 * request didn't originate from a share-sheet redirect or the source
 * couldn't be identified. Stage 0.5 wires it through so the Stage-0
 * measurement window can quantify the mobile-share share of
 * commerce-flagged volume.
 *
 * Returns the shape the consumer surfaces (web ResultCard, bot
 * formatters) read off `AnalysisResult.shopSignal`.
 */
export function buildShopSignal(
  redFlags: readonly string[],
  referrerSource?: ReferrerSource,
): {
  isCommerce: true;
  commerceFlags: string[];
  generatedAt: string;
  referrerSource?: ReferrerSource;
} {
  return {
    isCommerce: true,
    commerceFlags: extractCommerceFlags(redFlags),
    generatedAt: new Date().toISOString(),
    ...(referrerSource && { referrerSource }),
  };
}
