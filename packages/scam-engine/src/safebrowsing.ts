// URL reputation checks via Google Safe Browsing + VirusTotal
// Uses Promise.allSettled so failures don't block each other

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "./cost-log";
import { isPrivateIP } from "./private-ip";

// URL reputation cache — threat data changes slowly, no need to re-check every request.
// Naming is historical: MALICIOUS verdicts use SAFE_BROWSING_CACHE_TTL (short — we
// want to re-confirm a flagged URL sooner), CLEAN verdicts use the longer TTL (a
// non-malicious URL rarely flips, so cache it longer to protect the free-tier caps).
const SAFE_BROWSING_CACHE_TTL = 3_600;   // 1 hour  (malicious results)
const CLEAN_URL_CACHE_TTL = 86_400;      // 24 hours (non-malicious results — bumped from 6h)
const URL_CACHE_PREFIX = "askarthur:urlrep";

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

async function hashURL(url: string): Promise<string> {
  const data = new TextEncoder().encode(url);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface URLCheckResult {
  url: string;
  isMalicious: boolean;
  sources: string[];
}

// SSRF protection: private/internal IP ranges live in the shared ./private-ip
// classifier (isPrivateIP) — the single source of truth so the IPv4 + IPv6
// blocklists can't drift between this syntactic layer and the ssrf-dispatcher.
const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",        // GCP metadata
  "instance-data",                    // AWS metadata alias
];

/** Check if a URL points to a private/internal resource (SSRF protection) */
export function isPrivateURL(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);

    // Only allow http/https protocols
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return true;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block known internal hostnames
    if (BLOCKED_HOSTNAMES.includes(hostname)) return true;

    // IPv4 / IPv6 literal host (incl. bracketed IPv6, ULA/link-local/[::],
    // and IPv4-mapped) — delegate to the shared classifier so the IP ranges
    // are defined in exactly one place.
    if (isPrivateIP(hostname)) return true;

    // Block alternative IP notations (decimal, hex, octal) — these are
    // integer/hex encodings the classifier doesn't decode.
    // e.g., http://2130706433 (= 127.0.0.1), http://0x7f000001
    if (/^\d+$/.test(hostname)) return true;  // decimal IP
    if (/^0x[0-9a-f]+$/i.test(hostname)) return true;  // hex IP
    if (/^0[0-7]+$/.test(hostname)) return true;  // octal IP

    // Block metadata.goog (GCP alternate)
    if (hostname === "metadata.goog") return true;

    return false;
  } catch {
    // Malformed URL — block it
    return true;
  }
}

// Extract URLs from text, filtering out private/internal addresses
export function extractURLs(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  return [...new Set(matches)].filter((url) => !isPrivateURL(url));
}

async function checkGoogleSafeBrowsing(urls: string[]): Promise<Set<string>> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey || urls.length === 0) return new Set();

  const malicious = new Set<string>();

  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "askarthur", clientVersion: "1.0" },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION",
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: urls.map((url) => ({ url })),
          },
        }),
        signal: AbortSignal.timeout(5000),
      }
    );

    if (res.ok) {
      const data = (await res.json()) as { matches?: Array<{ threat: { url: string } }> };
      if (data.matches) {
        for (const match of data.matches) {
          malicious.add(match.threat.url);
        }
      }
      // Cost telemetry — free tier (no per-call charge) but track units so the
      // request volume is visible in /admin/costs ahead of any paid escalation.
      void logCost({
        feature: "url-reputation",
        provider: "google-safe-browsing",
        operation: "threatMatches.find",
        units: urls.length,
        estimatedCostUsd: 0,
      });
    }
  } catch {
    // Non-blocking: log but don't fail
    logger.warn("Google Safe Browsing check failed");
  }

  return malicious;
}

async function checkVirusTotal(urls: string[]): Promise<Set<string>> {
  const apiKey = process.env.VIRUSTOTAL_API_KEY;
  if (!apiKey || urls.length === 0) return new Set();

  const malicious = new Set<string>();

  // VirusTotal has rate limits, check up to 4 URLs
  const urlsToCheck = urls.slice(0, 4);

  // Cost telemetry — VirusTotal's public tier is free; the paid tier is metered
  // per lookup. We log units with $0 today (key unset / public tier); if a paid
  // key is ever configured, add a VIRUSTOTAL_CHECK_USD rate to ENGINE_PRICING so
  // this spend stops being invisible (the failure mode cost-log.ts exists for).
  void logCost({
    feature: "url-reputation",
    provider: "virustotal",
    operation: "urls.get",
    units: urlsToCheck.length,
    estimatedCostUsd: 0,
  });

  await Promise.allSettled(
    urlsToCheck.map(async (url) => {
      try {
        // URL must be base64url-encoded without padding
        const urlId = btoa(url).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        const res = await fetch(
          `https://www.virustotal.com/api/v3/urls/${urlId}`,
          {
            headers: { "x-apikey": apiKey },
            signal: AbortSignal.timeout(5000),
          }
        );

        if (res.ok) {
          const data = (await res.json()) as { data?: { attributes?: { last_analysis_stats?: { malicious: number; suspicious: number } } } };
          const stats = data.data?.attributes?.last_analysis_stats;
          if (stats && stats.malicious + stats.suspicious > 2) {
            malicious.add(url);
          }
        }
      } catch {
        // Non-blocking
      }
    })
  );

  return malicious;
}

export async function checkURLReputation(
  urls: string[]
): Promise<URLCheckResult[]> {
  if (urls.length === 0) return [];

  const redis = getRedis();

  // Check cache first for each URL
  const results: URLCheckResult[] = [];
  const uncachedURLs: string[] = [];

  if (redis) {
    await Promise.all(
      urls.map(async (url) => {
        try {
          const hash = await hashURL(url);
          const cached = await redis.get<URLCheckResult>(`${URL_CACHE_PREFIX}:${hash}`);
          if (cached) {
            results.push(cached);
          } else {
            uncachedURLs.push(url);
          }
        } catch {
          uncachedURLs.push(url);
        }
      })
    );
  } else {
    uncachedURLs.push(...urls);
  }

  if (uncachedURLs.length === 0) return results;

  // Run both checks in parallel for uncached URLs — failures don't block each other
  const [googleResult, vtResult] = await Promise.allSettled([
    checkGoogleSafeBrowsing(uncachedURLs),
    checkVirusTotal(uncachedURLs),
  ]);

  const googleMalicious =
    googleResult.status === "fulfilled" ? googleResult.value : new Set<string>();
  const vtMalicious =
    vtResult.status === "fulfilled" ? vtResult.value : new Set<string>();

  const freshResults = uncachedURLs.map((url) => {
    const sources: string[] = [];
    if (googleMalicious.has(url)) sources.push("Google Safe Browsing");
    if (vtMalicious.has(url)) sources.push("VirusTotal");
    return { url, isMalicious: sources.length > 0, sources };
  });

  // Cache fresh results (fire-and-forget)
  if (redis) {
    for (const r of freshResults) {
      hashURL(r.url)
        .then((hash) => {
          const ttl = r.isMalicious ? SAFE_BROWSING_CACHE_TTL : CLEAN_URL_CACHE_TTL;
          return redis.set(`${URL_CACHE_PREFIX}:${hash}`, r, { ex: ttl });
        })
        .catch(() => {});
    }
  }

  return [...results, ...freshResults];
}
