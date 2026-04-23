// Provider 2/5: LeakCheck phone-breach lookup.
//
// HIBP dropped phone support in the May 2025 2.0 redesign, so LeakCheck
// (leakcheck.io, Lithuania) is the primary phone-keyed breach provider.
// Default OFF via FF_LEAKCHECK_ENABLED until the DPA with APP-equivalent
// clauses is signed (APP 8 — overseas disclosure).
//
// Cache TTL 7 days — breach corpus changes slowly and per-call cost is
// amortised against the plan fee; we prefer sticky caching to minimise
// both $ and DPA-traffic volume.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import type { ProviderContract } from "../provider-contract";
import { unavailablePillar } from "../provider-contract";
import type { PillarResult } from "../types";

const CACHE_TTL = 7 * 86_400;
const CACHE_PREFIX = "askarthur:pf:leakcheck";
const LEAKCHECK_URL = "https://leakcheck.io/api/v2/query";

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

interface LeakCheckSource {
  name: string;
  breach_date?: string;
  leaked_fields?: string[];
}

interface LeakCheckApiResponse {
  success: boolean;
  found?: number;
  result?: Array<{ source?: LeakCheckSource; name?: string }>;
}

interface LeakCheckCacheEntry {
  breachCount: number;
  breachNames: string[];
  lastBreachDate: string | null;
  leakedFields: string[];
}

const EMPTY_CACHE_ENTRY: LeakCheckCacheEntry = {
  breachCount: 0,
  breachNames: [],
  lastBreachDate: null,
  leakedFields: [],
};

/**
 * Score formula:
 *   base:          min(breachCount * 12, 70)
 *   recent_breach: +15 if any breach within 365 days
 *   sensitive:     +10 if leaked_fields includes any of
 *                  [password, password_hash, hash, secret_question]
 * Capped at 100. A single breach without sensitive fields → 12 (safe band).
 * Three breaches + recent + sensitive → 12*3 + 15 + 10 = 61 → high band.
 */
function scoreBreach(entry: LeakCheckCacheEntry): number {
  const recent = entry.lastBreachDate
    ? Date.now() - new Date(entry.lastBreachDate).getTime() < 365 * 86_400_000
    : false;
  const sensitive = entry.leakedFields.some((f) =>
    ["password", "password_hash", "hash", "secret_question"].includes(
      f.toLowerCase(),
    ),
  );
  const score =
    Math.min(entry.breachCount * 12, 70) +
    (recent ? 15 : 0) +
    (sensitive ? 10 : 0);
  return Math.min(100, score);
}

export const leakcheckProvider: ProviderContract = {
  id: "leakcheck-phone",
  timeoutMs: 3000,

  async run(msisdn): Promise<PillarResult> {
    if (process.env.FF_LEAKCHECK_ENABLED !== "true") {
      return unavailablePillar("breach", "leakcheck_disabled");
    }
    const apiKey = process.env.LEAKCHECK_API_KEY;
    if (!apiKey) {
      return unavailablePillar("breach", "leakcheck_key_missing");
    }

    // Cache hit?
    const redis = getRedis();
    if (redis) {
      try {
        const cached = await redis.get<LeakCheckCacheEntry>(`${CACHE_PREFIX}:${msisdn}`);
        if (cached) {
          return {
            id: "breach",
            score: scoreBreach(cached),
            confidence: 0.85,
            available: true,
            detail: {
              source: "leakcheck",
              breach_count: cached.breachCount,
              breaches: cached.breachNames,
              last_breach_date: cached.lastBreachDate,
              leaked_fields: cached.leakedFields,
              cached: true,
            },
          };
        }
      } catch {
        // Cache miss path continues.
      }
    }

    try {
      const url = `${LEAKCHECK_URL}/${encodeURIComponent(msisdn)}?type=phone`;
      const res = await fetch(url, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(2500),
      });

      if (res.status === 404) {
        // 404 can mean "no breach" for this provider.
        if (redis) {
          redis
            .set(`${CACHE_PREFIX}:${msisdn}`, EMPTY_CACHE_ENTRY, { ex: CACHE_TTL })
            .catch(() => {});
        }
        return {
          id: "breach",
          score: 0,
          confidence: 0.85,
          available: true,
          detail: { source: "leakcheck", breach_count: 0, breaches: [] },
        };
      }
      if (res.status === 401 || res.status === 403) {
        return unavailablePillar("breach", `leakcheck_unauthorized_${res.status}`);
      }
      if (!res.ok) {
        logger.warn("leakcheck http error", { status: res.status });
        return unavailablePillar("breach", `leakcheck_http_${res.status}`);
      }

      const body = (await res.json()) as LeakCheckApiResponse;
      if (!body.success) {
        return unavailablePillar("breach", "leakcheck_not_found_response");
      }

      const results = body.result ?? [];
      const names: string[] = [];
      const fields = new Set<string>();
      let latest: string | null = null;
      for (const item of results) {
        const src = item.source;
        const name = src?.name ?? item.name;
        if (name && !names.includes(name)) names.push(name);
        if (src?.leaked_fields) for (const f of src.leaked_fields) fields.add(f);
        if (src?.breach_date) {
          if (!latest || src.breach_date > latest) latest = src.breach_date;
        }
      }

      const entry: LeakCheckCacheEntry = {
        breachCount: names.length,
        breachNames: names,
        lastBreachDate: latest,
        leakedFields: [...fields],
      };

      if (redis) {
        redis
          .set(`${CACHE_PREFIX}:${msisdn}`, entry, { ex: CACHE_TTL })
          .catch(() => {});
      }

      return {
        id: "breach",
        score: scoreBreach(entry),
        confidence: 0.85,
        available: true,
        detail: {
          source: "leakcheck",
          breach_count: entry.breachCount,
          breaches: entry.breachNames,
          last_breach_date: entry.lastBreachDate,
          leaked_fields: entry.leakedFields,
        },
      };
    } catch (err) {
      logger.warn("leakcheck provider failed", { error: String(err) });
      return unavailablePillar("breach", "leakcheck_error");
    }
  },
};
