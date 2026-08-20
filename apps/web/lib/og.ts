// Single source of knowledge for Open Graph preview images.
//
// Two rules live here, both learned the hard way:
//
// 1. NEXT METADATA IS SHALLOW-MERGED. A route that exports `openGraph` replaces
//    the root layout's `openGraph` wholesale — it does NOT inherit the parent's
//    `images`. So a page that sets only `openGraph.title` silently loses the
//    sitewide card. Verified 2026-08-20 against a dev server: /trust (no own
//    openGraph) inherited /og-default.png, while /about and /scam-feed — which
//    set openGraph without images — emitted no og:image at all.
//    => Any route exporting `openGraph` must set `images` explicitly.
//
// 2. LINKEDIN DOES NOT RENDER WEBP. A .webp og:image is not a smaller card, it
//    is NO card — the scrape succeeds and the post shows bare. All 23 published
//    blog posts carry .webp heroes (checked in prod 2026-08-20), so every one
//    of them was shipping an og:image LinkedIn could not use, while their own
//    openGraph blocked the PNG fallback.
//    => Route an image through ogImages() rather than passing it raw.

/** The sitewide fallback card. Regenerate via `pnpm --filter @askarthur/web og:card`. */
export const OG_DEFAULT_IMAGE_URL = "/og-default.png";

export const OG_DEFAULT_IMAGE = [
  {
    url: OG_DEFAULT_IMAGE_URL,
    width: 1200,
    height: 630,
    alt: "Ask Arthur — free AI scam checker for Australia",
  },
];

/**
 * Formats the major social scrapers actually decode. WebP and AVIF are
 * deliberately absent: both are fine for on-page `next/image` and neither
 * works as an og:image on LinkedIn.
 */
const SOCIAL_SAFE = /\.(png|jpe?g|gif)(\?|#|$)/i;

/**
 * Use `candidate` as the preview image when a scraper can actually render it;
 * otherwise fall back to the sitewide card. Passing an unusable image is worse
 * than passing none, because it suppresses the fallback.
 *
 * Dynamic OG routes (e.g. /api/og/scan) return PNG and have no extension, so
 * pass those through directly rather than via this helper.
 */
export function ogImages(candidate?: string | null): typeof OG_DEFAULT_IMAGE | [string] {
  if (candidate && SOCIAL_SAFE.test(candidate)) return [candidate];
  return OG_DEFAULT_IMAGE;
}
