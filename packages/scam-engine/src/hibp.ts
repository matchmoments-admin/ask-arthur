// Email breach exposure via Have I Been Pwned v3 API.
// Checks if an email address appears in known data breaches.
//
// THIS IS THE SINGLE ENTRY POINT FOR HIBP IN THE CODEBASE. All callers
// (apps/web/app/api/breach-check/route.ts, the entity-enrichment Inngest
// step) use these exports. Do not add direct fetch() calls to
// haveibeenpwned.com elsewhere — the route used to do that with no cache
// and no timeout, and the divergence (5s timeout + 24h cache here vs.
// nothing there) was a real reliability bug closed in W1.3.
//
// Two functions, two cache namespaces:
//   - checkHIBP(email)         → boolean + names. Uses ?truncateResponse=true.
//                                 Cheap; cached at askarthur:hibp:<sha256>.
//   - checkHIBPDetailed(email) → full breach metadata. Uses
//                                 ?truncateResponse=false. Larger payload
//                                 cached at askarthur:hibp:detail:<sha256>.
//
// Both share: 5s AbortSignal.timeout, 24h cache TTL, graceful degradation
// (missing API key → empty result, network/timeout/parse error → empty
// result + logged.error). Callers always get a well-typed object back.
//
// Cost telemetry: every cache-miss fetch (any outcome — 200, 404, timeout,
// 5xx) writes one row to cost_telemetry with feature='breach-check' so the
// daily summary surfaces HIBP call volume. HIBP is a flat-fee subscription
// ($3.95/mo for Pwned 4), so unit_cost_usd is 0 — the value is the row
// count itself, used to detect runaway quota burn (10 req/min cap) before
// the rate-limit kicks in. Cache hits are NOT logged (no upstream call).

import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

const CACHE_TTL = 86_400; // 24 hours — breach data rarely changes
const CACHE_PREFIX = "askarthur:hibp";
// Detail cache is separate so the existing checkHIBP() consumers (which
// only need names) don't pay for the larger payload's serialisation.
const DETAIL_CACHE_PREFIX = "askarthur:hibp:detail";
const HIBP_TIMEOUT_MS = 5000;

/**
 * Fire-and-forget cost row for a single HIBP upstream call. Never throws,
 * never blocks — a cost-telemetry insert failure must never break a breach
 * lookup. Returns a Promise the caller can `void` or hand to `waitUntil`.
 *
 * `outcome` distinguishes success / not-found / error so the daily admin
 * health-digest can flag failure rates without manually parsing 4xx/5xx.
 */
async function logHibpCall(
  mode: "check" | "detailed",
  outcome: "found" | "not_found" | "error",
  status?: number,
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  const { error } = await supabase.from("cost_telemetry").insert({
    feature: "breach-check",
    provider: "hibp",
    operation: mode === "detailed" ? "lookup_detailed" : "lookup",
    units: 1,
    // HIBP is flat-fee subscription, not per-call. Logged at $0 so the row
    // contributes to call-volume tracking without inflating dollar totals.
    // If/when HIBP moves to per-call billing, update PRICING in
    // apps/web/lib/cost-telemetry.ts and reference here.
    unit_cost_usd: 0,
    estimated_cost_usd: 0,
    metadata: { outcome, status: status ?? null },
  });
  if (error) {
    logger.warn("HIBP cost telemetry insert failed (non-fatal)", {
      error: error.message,
    });
  }
}

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
      void logHibpCall("check", "not_found", 404);
      if (redis) {
        redis.set(`${CACHE_PREFIX}:${emailHash}`, EMPTY_RESULT, { ex: CACHE_TTL }).catch(() => {});
      }
      return EMPTY_RESULT;
    }

    if (!res.ok) {
      void logHibpCall("check", "error", res.status);
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

    void logHibpCall("check", "found", res.status);

    // Cache result (fire-and-forget)
    if (redis) {
      redis.set(`${CACHE_PREFIX}:${emailHash}`, result, { ex: CACHE_TTL }).catch(() => {});
    }

    return result;
  } catch (err) {
    void logHibpCall("check", "error");
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

  let res: Response;
  try {
    res = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
      {
        headers: {
          "hibp-api-key": apiKey,
          "user-agent": "AskArthur-SafeCheck/1.0",
        },
        signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      },
    );
  } catch (err) {
    // Transport error before HIBP responded (timeout, DNS, network). Log
    // the attempt — the rate-limit may still have decremented if HIBP
    // received the request — then re-throw so the caller can return 502.
    void logHibpCall("detailed", "error");
    throw err;
  }

  if (res.status === 404) {
    void logHibpCall("detailed", "not_found", 404);
    if (redis) {
      redis.set(`${DETAIL_CACHE_PREFIX}:${emailHash}`, EMPTY_DETAIL, { ex: CACHE_TTL }).catch(() => {});
    }
    return EMPTY_DETAIL;
  }

  if (!res.ok) {
    void logHibpCall("detailed", "error", res.status);
    throw new Error(`HIBP API returned ${res.status}`);
  }

  const raw: RawBreachInfo[] = await res.json();
  const result: HIBPDetailedResult = {
    breached: raw.length > 0,
    breachCount: raw.length,
    breaches: raw.map(normaliseBreach),
  };

  void logHibpCall("detailed", "found", res.status);

  if (redis) {
    redis.set(`${DETAIL_CACHE_PREFIX}:${emailHash}`, result, { ex: CACHE_TTL }).catch(() => {});
  }

  return result;
}
