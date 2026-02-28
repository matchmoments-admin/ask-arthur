// IP abuse reputation via AbuseIPDB v2 API.
// Checks IP addresses against crowdsourced abuse reports.
// Graceful degradation: missing API key → skip, errors → empty result.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

const CACHE_TTL = 21_600; // 6 hours
const CACHE_PREFIX = "askarthur:abuseipdb";

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

export interface AbuseIPDBResult {
  abuseConfidenceScore: number;
  totalReports: number;
  lastReportedAt: string | null;
  isp: string | null;
  usageType: string | null;
  domain: string | null;
  isWhitelisted: boolean;
}

const EMPTY_RESULT: AbuseIPDBResult = {
  abuseConfidenceScore: 0,
  totalReports: 0,
  lastReportedAt: null,
  isp: null,
  usageType: null,
  domain: null,
  isWhitelisted: false,
};

/**
 * Check an IP address against AbuseIPDB.
 * Free tier: 1,000 checks/day. 5s timeout.
 */
export async function checkAbuseIPDB(ip: string): Promise<AbuseIPDBResult> {
  const apiKey = process.env.ABUSEIPDB_API_KEY;
  if (!apiKey) {
    logger.warn("ABUSEIPDB_API_KEY not set, skipping AbuseIPDB lookup");
    return EMPTY_RESULT;
  }

  // Check cache first
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<AbuseIPDBResult>(`${CACHE_PREFIX}:${ip}`);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to API
    }
  }

  try {
    const res = await fetch(
      `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
      {
        headers: {
          Key: apiKey,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      logger.warn("AbuseIPDB check failed", { status: res.status, ip });
      return EMPTY_RESULT;
    }

    const json = await res.json();
    const data = json.data;
    if (!data) return EMPTY_RESULT;

    const result: AbuseIPDBResult = {
      abuseConfidenceScore: data.abuseConfidenceScore ?? 0,
      totalReports: data.totalReports ?? 0,
      lastReportedAt: data.lastReportedAt ?? null,
      isp: data.isp ?? null,
      usageType: data.usageType ?? null,
      domain: data.domain ?? null,
      isWhitelisted: data.isWhitelisted ?? false,
    };

    // Cache result (fire-and-forget)
    if (redis) {
      redis.set(`${CACHE_PREFIX}:${ip}`, result, { ex: CACHE_TTL }).catch(() => {});
    }

    return result;
  } catch (err) {
    logger.error("AbuseIPDB lookup error", { error: String(err), ip });
    return EMPTY_RESULT;
  }
}
