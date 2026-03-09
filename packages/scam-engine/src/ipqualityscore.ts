// Phone number fraud scoring via IPQualityScore API.
// Checks phone numbers against IPQS fraud database (2.6B+ records).
// Graceful degradation: missing API key → skip, errors → empty result.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

const CACHE_TTL = 86_400; // 24 hours
const CACHE_PREFIX = "askarthur:ipqs";

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

export interface IPQSPhoneResult {
  fraudScore: number;
  valid: boolean;
  active: boolean;
  lineType: string | null;
  carrier: string | null;
  country: string | null;
  risky: boolean;
  recentAbuse: boolean;
  leaked: boolean;
  prepaid: boolean;
  doNotCall: boolean;
}

const EMPTY_RESULT: IPQSPhoneResult = {
  fraudScore: 0,
  valid: false,
  active: false,
  lineType: null,
  carrier: null,
  country: null,
  risky: false,
  recentAbuse: false,
  leaked: false,
  prepaid: false,
  doNotCall: false,
};

/**
 * Check a phone number against IPQualityScore.
 * Free tier: 1,000 lookups/month. 5s timeout.
 */
export async function checkIPQS(phone: string): Promise<IPQSPhoneResult> {
  const apiKey = process.env.IPQUALITYSCORE_API_KEY;
  if (!apiKey) {
    logger.warn("IPQUALITYSCORE_API_KEY not set, skipping IPQS lookup");
    return EMPTY_RESULT;
  }

  // Check cache first
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<IPQSPhoneResult>(`${CACHE_PREFIX}:${phone}`);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to API
    }
  }

  try {
    const res = await fetch(
      `https://www.ipqualityscore.com/api/json/phone/${encodeURIComponent(apiKey)}/${encodeURIComponent(phone)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      logger.warn("IPQS phone check failed", { status: res.status, phone });
      return EMPTY_RESULT;
    }

    const data = await res.json();
    if (!data || !data.success) return EMPTY_RESULT;

    const result: IPQSPhoneResult = {
      fraudScore: data.fraud_score ?? 0,
      valid: data.valid ?? false,
      active: data.active ?? false,
      lineType: data.line_type ?? null,
      carrier: data.carrier ?? null,
      country: data.country ?? null,
      risky: data.risky ?? false,
      recentAbuse: data.recent_abuse ?? false,
      leaked: data.leaked ?? false,
      prepaid: data.prepaid ?? false,
      doNotCall: data.do_not_call ?? false,
    };

    // Cache result (fire-and-forget)
    if (redis) {
      redis.set(`${CACHE_PREFIX}:${phone}`, result, { ex: CACHE_TTL }).catch(() => {});
    }

    return result;
  } catch (err) {
    logger.error("IPQS phone lookup error", { error: String(err), phone });
    return EMPTY_RESULT;
  }
}
