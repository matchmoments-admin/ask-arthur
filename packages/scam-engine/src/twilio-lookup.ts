// Twilio Lookup v2 — phone number intelligence.
// Moved from apps/web/lib/twilioLookup.ts to scam-engine so it can be called
// from both the web app (real-time) and the enrichment pipeline (background).
// Cost: $0.018/lookup (line type + CNAM).

import Twilio from "twilio";
import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import type { PhoneLookupResult, PhoneRiskLevel } from "@askarthur/types";

export type { PhoneLookupResult };

const CACHE_TTL = 86_400; // 24 hours — carrier/line type data is stable
const CACHE_PREFIX = "askarthur:twilio";

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

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials not configured");
  _client = Twilio(sid, token);
  return _client;
}

/**
 * Compute a 0-100 risk score from phone lookup signals.
 */
export function computePhoneRiskScore(flags: {
  isVoip: boolean;
  countryCode: string | null;
  lineType: string | null;
  valid: boolean;
  carrier: string | null;
  callerName: string | null;
}): { riskScore: number; riskLevel: PhoneRiskLevel } {
  let score = 0;
  if (flags.isVoip) score += 35;
  if (flags.countryCode && flags.countryCode !== "AU") score += 25;
  if (!flags.lineType || flags.lineType === "unknown") score += 20;
  if (!flags.valid) score += 15;
  if (!flags.carrier) score += 10;
  if (!flags.callerName) score += 5;
  score = Math.min(score, 100);

  const riskLevel: PhoneRiskLevel =
    score >= 70 ? "CRITICAL" :
    score >= 40 ? "HIGH" :
    score >= 20 ? "MEDIUM" :
    "LOW";

  return { riskScore: score, riskLevel };
}

/**
 * Look up a phone number via Twilio Lookup v2.
 * Line type intelligence ($0.008) + CNAM ($0.01) = $0.018/lookup.
 * Results cached in Redis for 24h.
 */
export async function lookupPhoneNumber(phoneNumber: string): Promise<PhoneLookupResult> {
  // Check cache first
  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<PhoneLookupResult>(`${CACHE_PREFIX}:${phoneNumber}`);
      if (cached) return cached;
    } catch {
      // Cache miss — continue to API
    }
  }

  const client = getClient();

  try {
    const result = await client.lookups.v2
      .phoneNumbers(phoneNumber)
      .fetch({ fields: "line_type_intelligence,caller_name", countryCode: "AU" });

    const lineType = result.lineTypeIntelligence?.type ?? null;
    const carrier = result.lineTypeIntelligence?.carrierName ?? null;
    const isVoip = lineType === "nonFixedVoip";
    const callerName = (result as unknown as Record<string, unknown>).callerName as { caller_name?: string; caller_type?: string } | null;
    const callerNameValue = callerName?.caller_name ?? null;
    const callerNameType = callerName?.caller_type ?? null;

    const riskFlags: string[] = [];
    if (isVoip) riskFlags.push("voip");
    if (!result.valid) riskFlags.push("invalid_number");
    if (result.countryCode && result.countryCode !== "AU") riskFlags.push("non_au_origin");
    if (!carrier) riskFlags.push("unknown_carrier");
    if (!callerNameValue) riskFlags.push("no_registered_name");

    const { riskScore, riskLevel } = computePhoneRiskScore({
      isVoip,
      countryCode: result.countryCode ?? null,
      lineType,
      valid: result.valid ?? false,
      carrier,
      callerName: callerNameValue,
    });

    const lookupResult: PhoneLookupResult = {
      valid: result.valid ?? false,
      phoneNumber: result.phoneNumber ?? phoneNumber,
      countryCode: result.countryCode ?? null,
      nationalFormat: result.nationalFormat ?? null,
      lineType,
      carrier,
      isVoip,
      riskFlags,
      riskScore,
      riskLevel,
      callerName: callerNameValue,
      callerNameType,
    };

    // Cache result (fire-and-forget)
    if (redis) {
      redis.set(`${CACHE_PREFIX}:${phoneNumber}`, lookupResult, { ex: CACHE_TTL }).catch(() => {});
    }

    return lookupResult;
  } catch (err) {
    logger.error("Twilio lookup failed", { phone: phoneNumber.slice(-4), error: String(err) });
    return {
      valid: false,
      phoneNumber,
      countryCode: null,
      nationalFormat: null,
      lineType: null,
      carrier: null,
      isVoip: false,
      riskFlags: ["lookup_failed"],
      riskScore: 0,
      riskLevel: "LOW",
      callerName: null,
      callerNameType: null,
    };
  }
}

/**
 * Extract Australian phone numbers from a transcript.
 * Returns deduplicated list with E.164 conversion.
 */
export function extractPhoneNumbers(
  transcript: string
): Array<{ original: string; e164: string | null }> {
  const patterns = [
    /\+\d{10,15}/g, // International E.164
    /\b0[45]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, // AU mobile: 04xx/05xx xxx xxx
    /\b\(?0[2378]\)?[\s.-]?\d{4}[\s.-]?\d{4}\b/g, // AU landline: (0x) xxxx xxxx
    /\b(?:13\d{4}|1300[\s.-]?\d{3}[\s.-]?\d{3}|1800[\s.-]?\d{3}[\s.-]?\d{3})\b/g, // AU toll-free/local rate
  ];

  const seen = new Set<string>();
  const results: Array<{ original: string; e164: string | null }> = [];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(transcript)) !== null) {
      const cleaned = match[0].replace(/[\s.\-()]/g, "");
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);

      let e164: string | null = null;
      if (/^\+61\d{9}$/.test(cleaned)) e164 = cleaned;
      else if (/^0[2-578]\d{8}$/.test(cleaned)) e164 = `+61${cleaned.slice(1)}`;
      // 13/1300/1800 numbers don't have E.164 equivalents — skip Twilio lookup

      results.push({ original: match[0], e164 });
    }
  }

  return results;
}
