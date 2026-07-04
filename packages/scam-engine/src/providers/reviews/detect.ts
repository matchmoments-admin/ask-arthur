// Review-app fingerprinting — Deep Shop Check Stage 1 (reviews signal).
//
// Pure: given a shop page's static HTML, identify which review app the store
// uses and extract the identifier(s) its public data endpoint needs. No I/O.
//
// The four target apps inject their review UI client-side, but they all leave
// a Liquid-rendered loader stub / config in the static HTML (the same markup
// fetchShopPage already retrieves), so detection keys off those stubs. The
// extracted identifiers originate in attacker-controlled HTML, so every one is
// charset-validated here before any adapter builds a URL from it.
//
// Verified live (2026-07): the Okendo path against kouvrfashion.com. The
// Yotpo / Loox / Judge.me identifier shapes are documented but their fetchers
// are staged pending their own live probe — detect still names the app so the
// coverage gap is visible in telemetry.

import type { ReviewApp } from "../../reviews-signal";

export interface DetectedReviewApp {
  app: ReviewApp;
  /** Primary store/subscriber/site identifier for the app's data endpoint. */
  identifier: string;
  /**
   * Product-scoped id, for apps whose reviews endpoint is per-product
   * (Okendo: `shopify-<digits>`). Absent for site-wide endpoints.
   */
  productId?: string;
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const OKENDO_PRODUCT_ID = /(shopify-\d{6,})/i;
// Yotpo public app keys are alphanumeric tokens embedded in the widget host.
const YOTPO_APP_KEY = /(?:staticw2\.yotpo\.com|api-cdn\.yotpo\.com\/v1\/widget)\/([A-Za-z0-9]{8,})/i;
// A Shopify permanent domain, used by Judge.me's public widget endpoint.
const MYSHOPIFY_DOMAIN = /([a-z0-9-]+\.myshopify\.com)/i;

function detectOkendo(html: string): DetectedReviewApp | null {
  if (!/okendo/i.test(html)) return null;
  // subscriberId appears both as `subscriberId":"<guid>"` in the widget config
  // and inside the `api.okendo.io/v1/stores/<guid>` URLs. Either yields it.
  const sub =
    html.match(new RegExp(`subscriberId"\\s*:\\s*"(${GUID.source})"`, "i"))?.[1] ??
    html.match(new RegExp(`okendo\\.io\\/v1\\/stores\\/(${GUID.source})`, "i"))?.[1] ??
    html.match(new RegExp(`subscriberId=(${GUID.source})`, "i"))?.[1];
  if (!sub) return null;
  const productId = html.match(OKENDO_PRODUCT_ID)?.[1];
  return { app: "okendo", identifier: sub.toLowerCase(), ...(productId && { productId }) };
}

function detectYotpo(html: string): DetectedReviewApp | null {
  if (!/yotpo/i.test(html)) return null;
  const key = html.match(YOTPO_APP_KEY)?.[1];
  // Detect the app even without a key so the coverage gap is visible; an empty
  // identifier makes the orchestrator skip with `no-identifier`.
  return { app: "yotpo", identifier: key ?? "" };
}

function detectLoox(html: string): DetectedReviewApp | null {
  if (!/loox\.(io|app)/i.test(html) && !/looxReviews/i.test(html)) return null;
  // Loox's public storefront id lives in its widget config; shape unconfirmed,
  // so best-effort. Empty identifier → orchestrator skips.
  const id = html.match(/loox[^"]*?["']?(?:store|shop)Id["']?\s*[:=]\s*["']([A-Za-z0-9-]{6,})/i)?.[1];
  return { app: "loox", identifier: id ?? "" };
}

function detectJudgeMe(html: string): DetectedReviewApp | null {
  if (!/jdgm-|judge\.me/i.test(html)) return null;
  const shop = html.match(MYSHOPIFY_DOMAIN)?.[1];
  return { app: "judgeme", identifier: shop?.toLowerCase() ?? "" };
}

/**
 * Detect the review app in use, or null when none of the supported apps is
 * fingerprinted. Okendo is checked first (the verified path); the others are
 * detect-only for now.
 */
export function detectReviewApp(html: string): DetectedReviewApp | null {
  return (
    detectOkendo(html) ??
    detectYotpo(html) ??
    detectLoox(html) ??
    detectJudgeMe(html)
  );
}
