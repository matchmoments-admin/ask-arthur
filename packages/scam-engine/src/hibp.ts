// Email breach exposure via Have I Been Pwned v3 API.
// Checks if an email address appears in known data breaches.
// Graceful degradation: missing API key → skip, errors → empty result.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

const CACHE_TTL = 86_400; // 24 hours — breach data rarely changes
const CACHE_PREFIX = "askarthur:hibp";

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

async function hashEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface HIBPResult {
  breachCount: number;
  breachNames: string[];
  isBreached: boolean;
}

const EMPTY_RESULT: HIBPResult = {
  breachCount: 0,
  breachNames: [],
  isBreached: false,
};

/**
 * Check an email address against Have I Been Pwned.
 * Paid API key required ($3.50/mo). Rate limit: 10 req/min.
 * 5s timeout. 404 = not breached.
 */
export async function checkHIBP(email: string): Promise<HIBPResult> {
  const apiKey = process.env.HIBP_API_KEY;
  if (!apiKey) {
    logger.warn("HIBP_API_KEY not set, skipping HIBP lookup");
    return EMPTY_RESULT;
  }

  // Check cache first (keyed by SHA-256 of email for privacy)
  const redis = getRedis();
  const emailHash = await hashEmail(email);
  if (redis) {
    try {
      const cached = await redis.get<HIBPResult>(`${CACHE_PREFIX}:${emailHash}`);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to API
    }
  }

  try {
    const res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`,
      {
        headers: {
          "hibp-api-key": apiKey,
          "user-agent": "AskArthur-SafeCheck/1.0",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    // 404 = not found in any breaches
    if (res.status === 404) {
      if (redis) {
        redis.set(`${CACHE_PREFIX}:${emailHash}`, EMPTY_RESULT, { ex: CACHE_TTL }).catch(() => {});
      }
      return EMPTY_RESULT;
    }

    if (!res.ok) {
      logger.warn("HIBP check failed", { status: res.status });
      return EMPTY_RESULT;
    }

    const breaches = await res.json();
    const breachNames = Array.isArray(breaches)
      ? breaches.map((b: { Name: string }) => b.Name)
      : [];

    const result: HIBPResult = {
      breachCount: breachNames.length,
      breachNames,
      isBreached: breachNames.length > 0,
    };

    // Cache result (fire-and-forget)
    if (redis) {
      redis.set(`${CACHE_PREFIX}:${emailHash}`, result, { ex: CACHE_TTL }).catch(() => {});
    }

    return result;
  } catch (err) {
    logger.error("HIBP lookup error", { error: String(err) });
    return EMPTY_RESULT;
  }
}
