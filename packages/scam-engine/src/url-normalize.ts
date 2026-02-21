// URL normalization and domain extraction for scam URL reporting.
// Uses tldts for accurate TLD extraction (.com.au, .co.uk, etc.)

import { parse as parseTld } from "tldts";

// Tracking parameters to strip from URLs
const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
  "source",
  "campaign",
]);

export interface NormalizedURL {
  normalized: string;
  domain: string;
  subdomain: string | null;
  tld: string;
  fullPath: string;
}

/**
 * Normalize a URL for deduplication and storage.
 * - Lowercases scheme + hostname
 * - Strips tracking params (utm_*, fbclid, gclid, etc.)
 * - Strips trailing slashes
 * - Strips fragments (#)
 * - Decodes URL-encoded characters in path
 */
export function normalizeURL(rawUrl: string): NormalizedURL | null {
  try {
    const url = new URL(rawUrl);

    // Only allow http/https
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    // Lowercase scheme + hostname
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();

    // Strip tracking params
    const params = new URLSearchParams(url.search);
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        params.delete(key);
      }
    }

    // Rebuild search string
    const search = params.toString();
    url.search = search ? `?${search}` : "";

    // Strip fragment
    url.hash = "";

    // Decode path
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      path = url.pathname;
    }

    // Strip trailing slash (unless path is just "/")
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    // Extract domain components using tldts
    const tldResult = parseTld(url.hostname);
    const domain = tldResult.domain || url.hostname;
    const subdomain = tldResult.subdomain || null;
    const tld = tldResult.publicSuffix ? `.${tldResult.publicSuffix}` : "";

    // Build normalized URL
    const normalized = `${url.protocol}//${url.hostname}${path}${url.search}`;

    // Full path = path + query string
    const fullPath = `${path}${url.search}`;

    return { normalized, domain, subdomain, tld, fullPath };
  } catch {
    return null;
  }
}

/** Extract just the domain from a URL string */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    const tldResult = parseTld(parsed.hostname);
    return tldResult.domain || parsed.hostname;
  } catch {
    return null;
  }
}

/** Validate whether a string looks like a URL */
export function isURLFormat(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
