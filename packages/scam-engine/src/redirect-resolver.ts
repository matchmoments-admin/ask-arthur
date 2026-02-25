// Redirect chain resolution for URL shorteners and obfuscated links.
// Uses native fetch with redirect: 'manual' — zero new dependencies.

import { logger } from "@askarthur/utils/logger";
import { isPrivateURL } from "./safebrowsing";
import { extractDomain } from "./url-normalize";
import type { RedirectHop, RedirectChain } from "@askarthur/types";

// ── Known URL shortener domains ──

const SHORTENER_DOMAINS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "adf.ly",
  "bl.ink",
  "lnkd.in",
  "db.tt",
  "qr.ae",
  "rebrand.ly",
  "short.io",
  "cutt.ly",
  "rb.gy",
  "shorturl.at",
  "tiny.cc",
  "surl.li",
  "v.gd",
]);

// ── Open redirect detection patterns ──

const OPEN_REDIRECT_PATTERNS: { host: RegExp; pathOrParam: RegExp }[] = [
  // Google
  { host: /^(www\.)?google\.[a-z.]+$/i, pathOrParam: /\/url\?/ },
  { host: /^(www\.)?google\.[a-z.]+$/i, pathOrParam: /\/amp\/s\// },
  { host: /^(www\.)?google\.[a-z.]+$/i, pathOrParam: /\/travel\/clk/ },
  // Facebook
  { host: /^(l|lm)\.facebook\.com$/i, pathOrParam: /\/l\.php\?/ },
  // YouTube
  { host: /^(www\.)?youtube\.com$/i, pathOrParam: /\/redirect\?/ },
];

const REDIRECT_PARAM_NAMES = new Set([
  "url",
  "redirect",
  "next",
  "dest",
  "goto",
  "u",
  "q",
  "target",
  "return",
  "returnto",
  "redirect_uri",
  "redirect_url",
]);

// ── Configuration ──

export interface ResolveOptions {
  maxHops?: number;
  perHopTimeoutMs?: number;
  totalTimeoutMs?: number;
  userAgent?: string;
}

const DEFAULTS: Required<ResolveOptions> = {
  maxHops: 10,
  perHopTimeoutMs: 5_000,
  totalTimeoutMs: 30_000,
  userAgent: "AskArthur-SafeCheck/1.0",
};

// ── Public API ──

/** Check if a URL's domain is a known URL shortener. */
export function isKnownShortener(url: string): boolean {
  const domain = extractDomain(url);
  if (!domain) return false;
  return SHORTENER_DOMAINS.has(domain.toLowerCase());
}

/** Detect if a URL uses a known open redirect pattern. */
export function detectOpenRedirect(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Check known service patterns
    for (const pattern of OPEN_REDIRECT_PATTERNS) {
      if (
        pattern.host.test(parsed.hostname) &&
        pattern.pathOrParam.test(parsed.pathname + parsed.search)
      ) {
        return true;
      }
    }

    // Check for generic redirect params containing full URLs
    for (const [key, value] of parsed.searchParams) {
      if (
        REDIRECT_PARAM_NAMES.has(key.toLowerCase()) &&
        /^https?:\/\//i.test(value)
      ) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Follow a single URL's redirect chain.
 * Uses HEAD first (cheaper), falls back to GET on 405.
 * Checks isPrivateURL() at every hop for SSRF protection.
 */
export async function resolveRedirectChain(
  url: string,
  opts?: ResolveOptions
): Promise<RedirectChain> {
  const config = { ...DEFAULTS, ...opts };
  const hops: RedirectHop[] = [];
  const seen = new Set<string>();
  let currentUrl = url;
  let truncated = false;
  let hasOpenRedirect = false;
  let error: string | undefined;

  const totalDeadline = Date.now() + config.totalTimeoutMs;

  for (let i = 0; i < config.maxHops; i++) {
    // Check total timeout
    if (Date.now() >= totalDeadline) {
      truncated = true;
      error = "Total timeout exceeded";
      break;
    }

    // Circular redirect detection
    if (seen.has(currentUrl)) {
      error = "Circular redirect detected";
      break;
    }
    seen.add(currentUrl);

    // SSRF check before every fetch
    if (isPrivateURL(currentUrl)) {
      error = "Redirect to private/internal address blocked";
      break;
    }

    // Open redirect detection
    if (detectOpenRedirect(currentUrl)) {
      hasOpenRedirect = true;
    }

    const hopStart = Date.now();
    let response: Response;

    try {
      // Try HEAD first (cheaper)
      response = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        headers: { "User-Agent": config.userAgent },
        signal: AbortSignal.timeout(config.perHopTimeoutMs),
      });

      // If HEAD returns 405 Method Not Allowed, fallback to GET
      if (response.status === 405) {
        response = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": config.userAgent },
          signal: AbortSignal.timeout(config.perHopTimeoutMs),
        });
      }
    } catch (err) {
      error = `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }

    const latencyMs = Date.now() - hopStart;
    const statusCode = response.status;

    // Is this a redirect? (3xx with Location header)
    const location = response.headers.get("location");
    if (statusCode >= 300 && statusCode < 400 && location) {
      // Resolve relative redirects
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).href;
      } catch {
        error = `Invalid redirect Location: ${location}`;
        hops.push({ url: currentUrl, statusCode, latencyMs });
        break;
      }

      hops.push({ url: currentUrl, statusCode, latencyMs });
      currentUrl = nextUrl;
      continue;
    }

    // Non-redirect response — we've reached the final destination
    hops.push({ url: currentUrl, statusCode, latencyMs });
    break;
  }

  // If we hit maxHops, mark as truncated
  if (hops.length >= config.maxHops) {
    truncated = true;
    error = error || "Maximum redirect hops reached";
  }

  const isShortened = isKnownShortener(url);
  const finalUrl = hops.length > 0 ? hops[hops.length - 1].url : url;

  return {
    originalUrl: url,
    finalUrl: currentUrl !== url ? currentUrl : finalUrl,
    hops,
    hopCount: hops.length,
    isShortened,
    hasOpenRedirect,
    truncated,
    ...(error && { error }),
  };
}

/**
 * Resolve redirect chains for multiple URLs in parallel.
 * Uses Promise.allSettled so one failure doesn't block others.
 */
export async function resolveRedirects(
  urls: string[],
  opts?: ResolveOptions
): Promise<RedirectChain[]> {
  if (urls.length === 0) return [];

  const results = await Promise.allSettled(
    urls.map((url) => resolveRedirectChain(url, opts))
  );

  return results.map((result, i) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    // Rejection shouldn't happen (resolveRedirectChain catches internally),
    // but handle gracefully
    logger.warn("resolveRedirectChain rejected", {
      url: urls[i],
      error: String(result.reason),
    });
    return {
      originalUrl: urls[i],
      finalUrl: urls[i],
      hops: [],
      hopCount: 0,
      isShortened: isKnownShortener(urls[i]),
      hasOpenRedirect: false,
      truncated: false,
      error: String(result.reason),
    };
  });
}

/**
 * Extract unique final URLs that differ from their originals.
 * Used to expand the URL list for reputation checking.
 */
export function extractFinalUrls(chains: RedirectChain[]): string[] {
  const finals = new Set<string>();

  for (const chain of chains) {
    if (chain.finalUrl && chain.finalUrl !== chain.originalUrl) {
      finals.add(chain.finalUrl);
    }
  }

  return [...finals];
}
