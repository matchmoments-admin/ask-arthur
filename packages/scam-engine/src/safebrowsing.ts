// URL reputation checks via Google Safe Browsing + VirusTotal
// Uses Promise.allSettled so failures don't block each other

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

// URL reputation cache — threat data changes slowly, no need to re-check every request
const SAFE_BROWSING_CACHE_TTL = 3_600;   // 1 hour
const VIRUSTOTAL_CACHE_TTL = 21_600;     // 6 hours
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

// SSRF protection: private/internal IP ranges that must never be fetched
const PRIVATE_IP_PATTERNS = [
  /^127\./,                          // Loopback (127.0.0.0/8)
  /^10\./,                           // Class A private (10.0.0.0/8)
  /^172\.(1[6-9]|2\d|3[01])\./,     // Class B private (172.16.0.0/12)
  /^192\.168\./,                     // Class C private (192.168.0.0/16)
  /^169\.254\./,                     // Link-local (169.254.0.0/16, includes AWS metadata)
  /^0\./,                            // Current network (0.0.0.0/8)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // Shared address space (100.64.0.0/10)
  /^198\.1[89]\./,                   // Benchmarking (198.18.0.0/15)
];

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

    // Block IPv6 loopback
    if (hostname === "[::1]" || hostname === "::1") return true;

    // Check against private IP patterns
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(hostname)) return true;
    }

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
      const data = await res.json();
      if (data.matches) {
        for (const match of data.matches) {
          malicious.add(match.threat.url);
        }
      }
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
          const data = await res.json();
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
          const ttl = r.isMalicious ? SAFE_BROWSING_CACHE_TTL : VIRUSTOTAL_CACHE_TTL;
          return redis.set(`${URL_CACHE_PREFIX}:${hash}`, r, { ex: ttl });
        })
        .catch(() => {});
    }
  }

  return [...results, ...freshResults];
}
