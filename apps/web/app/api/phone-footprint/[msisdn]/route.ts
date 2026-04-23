// GET /api/phone-footprint/[msisdn]
//
// Primary lookup endpoint for Phone Footprint. Behaviour depends on who
// calls it:
//
//   Anonymous (no session)                                  →  teaser
//     Rate limits: pf_anon_burst (3/hr/IP) + pf_anon_daily (10/day/IP)
//     Turnstile required on 2nd+ lookup from same IP in 24h
//
//   Authenticated + ownership proven (OTP verified)         →  full
//     Rate limit: pf_user (60/min/user)
//
//   Authenticated + NOT ownership proven                    →  teaser
//     The APP 3.5 self-lookup compliance gate. Paid-tier users still get
//     teaser output for numbers they don't own unless their number has
//     a verified_scam record (public-interest carve-out).
//
//   Any caller + msisdn seen from 3+ IPs in last 24h        →  teaser
//     Enumeration-defence downgrade.
//
// Everything is flag-gated under NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER.
// While the flag is off, returns 503 with error='feature_disabled'.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkPhoneFootprintRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import {
  buildPhoneFootprint,
  persistFootprint,
  hashIdentifierForPf,
  hashMsisdn,
  normalizePhoneE164,
  effectiveTier,
} from "@askarthur/scam-engine/phone-footprint";
import type { FootprintTier } from "@askarthur/scam-engine/phone-footprint";
import { getUser } from "@/lib/auth";
import { verifyTurnstileToken } from "@/app/api/extension/_lib/turnstile";

export const runtime = "nodejs";
export const maxDuration = 10;

const OWNERSHIP_SESSION_PREFIX = "pf:owner";
const CROSSIP_KEY_PREFIX = "askarthur:pf:crossip";
const CROSSIP_WINDOW_SECONDS = 24 * 60 * 60;
const CROSSIP_THRESHOLD = 3;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)
    return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

/**
 * Track the set of IPs that have queried a given msisdn_hash in the last 24h.
 * Returns `true` when the IP count is at or above the enumeration threshold,
 * meaning the caller should receive teaser-only output regardless of their
 * tier. Written as an Upstash SADD + EXPIRE so it's a single round-trip
 * cost inside the hot path.
 */
async function recordAndCheckCrossIp(
  msisdnHash: string,
  ipHash: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false; // Fail open — cache unavailable shouldn't block lookup.
  const key = `${CROSSIP_KEY_PREFIX}:${msisdnHash}`;
  try {
    await redis.sadd(key, ipHash);
    await redis.expire(key, CROSSIP_WINDOW_SECONDS);
    const size = await redis.scard(key);
    return size >= CROSSIP_THRESHOLD;
  } catch (err) {
    logger.warn("crossip check failed", { error: String(err) });
    return false;
  }
}

/**
 * Check whether the user has OTP-verified ownership of this msisdn within
 * the 30-day session window. Uses the Upstash key set by /verify/check.
 * Returns false for anonymous callers.
 */
async function hasOwnershipProof(
  userId: string | null,
  msisdnHash: string,
): Promise<boolean> {
  if (!userId) return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const v = await redis.get(`${OWNERSHIP_SESSION_PREFIX}:${userId}:${msisdnHash}`);
    return v !== null;
  } catch {
    return false;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ msisdn: string }> },
) {
  // --- Feature flag
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }

  // --- Normalize the input (AU E.164)
  const { msisdn: rawMsisdn } = await params;
  const msisdn = normalizePhoneE164(decodeURIComponent(rawMsisdn));
  if (!msisdn) {
    return NextResponse.json({ error: "invalid_msisdn" }, { status: 400 });
  }

  const msisdnHash = hashMsisdn(msisdn);
  const ip = clientIp(req);
  const ipHash = hashIdentifierForPf("ip", ip);

  // --- Who's calling?
  const user = await getUser();
  const requestedTier: FootprintTier = user ? "full" : "teaser";

  // --- Rate limits per tier
  if (user) {
    const rl = await checkPhoneFootprintRateLimit("user", user.id);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retry_after: rl.resetAt?.toISOString() ?? null },
        { status: 429 },
      );
    }
  } else {
    const burst = await checkPhoneFootprintRateLimit("anon_burst", ipHash);
    if (!burst.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retry_after: burst.resetAt?.toISOString() ?? null },
        { status: 429 },
      );
    }
    const daily = await checkPhoneFootprintRateLimit("anon_daily", ipHash);
    if (!daily.allowed) {
      return NextResponse.json(
        { error: "rate_limited", retry_after: daily.resetAt?.toISOString() ?? null },
        { status: 429 },
      );
    }

    // --- Anon-only: Turnstile on 2nd+ call. We detect "2nd call" by
    // checking whether the daily bucket has seen this IP before — remaining
    // < max means we've already spent one this window.
    if (daily.remaining < 9) {
      const token = req.headers.get("x-turnstile-token") ?? "";
      if (!token) {
        return NextResponse.json(
          { error: "turnstile_required" },
          { status: 428 }, // precondition required
        );
      }
      const verdict = await verifyTurnstileToken(token, ip);
      if (!verdict.success) {
        return NextResponse.json(
          { error: "turnstile_failed", codes: verdict.errorCodes ?? [] },
          { status: 401 },
        );
      }
    }
  }

  // --- Cross-IP enumeration detection — forces teaser-only regardless of tier
  const crossIpDowngrade = await recordAndCheckCrossIp(msisdnHash, ipHash);

  // --- Ownership proof (cheap Redis hit)
  const ownershipProven = await hasOwnershipProof(user?.id ?? null, msisdnHash);

  const tier = effectiveTier({
    requestedTier,
    ownershipProven,
    crossIpDowngrade,
  });

  // --- Orchestrate
  const footprint = await buildPhoneFootprint(msisdn, {
    tier,
    userId: user?.id,
    requestId: req.headers.get("x-request-id") ?? undefined,
    ownershipProven,
  });

  // --- Persist snapshot (fire-and-forget; errors logged but don't block)
  void persistFootprint(footprint, { userId: user?.id });

  // --- Respond. The `crossip_downgrade` flag is surfaced so the UI can
  // explain why a paid user is seeing teaser output — "too many lookups
  // of this number from different sources, showing summary only."
  return NextResponse.json({
    ...footprint,
    ownership_proven: ownershipProven,
    crossip_downgrade: crossIpDowngrade,
  });
}
