// POST /api/phone-footprint/verify/check
//
// Validates the OTP code the user typed. On `approved`:
//   1. Updates phone_footprint_otp_attempts.status → 'approved'.
//   2. Stamps user_profiles.phone_e164 + phone_e164_hash + phone_verified_at
//      so future paid-tier lookups skip re-OTP for ~30 days.
//   3. Writes a 30-day Upstash session flag
//      `pf:owner:{user_id}:{msisdn_hash}` so the paid lookup route avoids
//      a DB round-trip on the ownership check.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkPhoneFootprintRateLimit } from "@askarthur/utils/rate-limit";
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  hashMsisdn,
  hashIdentifierForPf,
  normalizePhoneE164,
} from "@askarthur/scam-engine/phone-footprint";
import { getUser } from "@/lib/auth";
import { checkVerification } from "@/lib/twilioVerify";

export const runtime = "nodejs";
export const maxDuration = 10;

const BodySchema = z.object({
  msisdn: z.string().min(6).max(32),
  code: z.string().regex(/^\d{4,10}$/),
});

const OWNERSHIP_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

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

export async function POST(req: NextRequest) {
  if (!featureFlags.twilioVerifyEnabled) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const msisdn = normalizePhoneE164(body.msisdn);
  if (!msisdn) {
    return NextResponse.json({ error: "invalid_msisdn" }, { status: 400 });
  }
  const msisdnHash = hashMsisdn(msisdn);
  const ipHash = hashIdentifierForPf("ip", clientIp(req));

  // Reuse the IP bucket on check too — bots run check-then-check loops
  // hoping to hit the right 6-digit code. Twilio Verify itself enforces a
  // ceiling, but cheap belt-and-braces keeps our logs clean.
  const ipLimit = await checkPhoneFootprintRateLimit("verify_otp_ip", ipHash);
  if (!ipLimit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited_ip",
        retry_after: ipLimit.resetAt?.toISOString() ?? null,
      },
      { status: 429 },
    );
  }

  const result = await checkVerification(msisdn, body.code);

  const supa = createServiceClient();

  if (!result.approved) {
    // Update the most recent pending attempt for this (user, msisdn_hash) to denied.
    if (supa) {
      try {
        await supa
          .from("phone_footprint_otp_attempts")
          .update({ status: "denied" })
          .eq("msisdn_hash", msisdnHash)
          .eq("user_id", user.id)
          .eq("status", "pending");
      } catch (err) {
        logger.warn("otp attempt denied update failed", { error: String(err) });
      }
    }
    return NextResponse.json({ approved: false }, { status: 200 });
  }

  // --- Approved path. Stamp durable ownership proof.
  if (supa) {
    try {
      await supa
        .from("phone_footprint_otp_attempts")
        .update({ status: "approved" })
        .eq("msisdn_hash", msisdnHash)
        .eq("user_id", user.id)
        .eq("status", "pending");

      await supa
        .from("user_profiles")
        .update({
          phone_e164: msisdn,
          phone_e164_hash: msisdnHash,
          phone_verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    } catch (err) {
      logger.warn("otp approved writes failed", { error: String(err) });
    }
  }

  // Session flag for 30-day fast-path.
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(
        `pf:owner:${user.id}:${msisdnHash}`,
        { verified_at: new Date().toISOString() },
        { ex: OWNERSHIP_SESSION_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn("otp session flag set failed", { error: String(err) });
    }
  }

  return NextResponse.json({ approved: true });
}
