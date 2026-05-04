// Email breach exposure via Have I Been Pwned v3 API.
// Checks if an email address appears in known data breaches.
// Graceful degradation: missing API key → skip, errors → empty result.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

const CACHE_TTL = 86_400; // 24 hours — breach data rarely changes
const CACHE_PREFIX = "askarthur:hibp";
// Detail cache is separate so the existing checkHIBP() consumers (which
// only need names) don't pay for the larger payload's serialisation.
const DETAIL_CACHE_PREFIX = "askarthur:hibp:detail";
const HIBP_TIMEOUT_MS = 5000;

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

export interface HIBPBreachDetail {
  name: string;
  title: string;
  domain: string;
  date: string;
  dataTypes: string[];
}

export interface HIBPDetailedResult {
  breached: boolean;
  breachCount: number;
  breaches: HIBPBreachDetail[];
}

const EMPTY_RESULT: HIBPResult = {
  breachCount: 0,
  breachNames: [],
  isBreached: false,
};

const EMPTY_DETAIL: HIBPDetailedResult = {
  breached: false,
  breachCount: 0,
  breaches: [],
};

interface RawBreachInfo {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  DataClasses: string[];
}

function normaliseBreach(raw: RawBreachInfo): HIBPBreachDetail {
  return {
    name: raw.Name,
    title: raw.Title,
    domain: raw.Domain,
    date: raw.BreachDate,
    dataTypes: raw.DataClasses,
  };
}

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
        signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
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

/**
 * Same HIBP lookup as `checkHIBP` but returns the full breach metadata
 * (title, domain, date, data classes). Used by the /api/breach-check route
 * which renders breach details to the user. 24h cache + 5s AbortSignal
 * timeout — both were missing from the route's previous direct fetch.
 *
 * Throws on transport errors (timeout, 5xx, network) so the caller can
 * distinguish "checked, no breaches" from "could not check". 404 from
 * HIBP is the documented "no breaches" signal — not an error.
 */
export async function checkHIBPDetailed(email: string): Promise<HIBPDetailedResult> {
  const apiKey = process.env.HIBP_API_KEY;
  if (!apiKey) {
    throw new Error("HIBP_API_KEY not configured");
  }

  const redis = getRedis();
  const emailHash = await hashEmail(email);
  if (redis) {
    try {
      const cached = await redis.get<HIBPDetailedResult>(`${DETAIL_CACHE_PREFIX}:${emailHash}`);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to API
    }
  }

  const res = await fetch(
    `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    {
      headers: {
        "hibp-api-key": apiKey,
        "user-agent": "AskArthur-SafeCheck/1.0",
      },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
    },
  );

  if (res.status === 404) {
    if (redis) {
      redis.set(`${DETAIL_CACHE_PREFIX}:${emailHash}`, EMPTY_DETAIL, { ex: CACHE_TTL }).catch(() => {});
    }
    return EMPTY_DETAIL;
  }

  if (!res.ok) {
    throw new Error(`HIBP API returned ${res.status}`);
  }

  const raw: RawBreachInfo[] = await res.json();
  const result: HIBPDetailedResult = {
    breached: raw.length > 0,
    breachCount: raw.length,
    breaches: raw.map(normaliseBreach),
  };

  if (redis) {
    redis.set(`${DETAIL_CACHE_PREFIX}:${emailHash}`, result, { ex: CACHE_TTL }).catch(() => {});
  }

  return result;
}
