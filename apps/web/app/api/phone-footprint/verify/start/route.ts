// POST /api/phone-footprint/verify/start
//
// Sends a Twilio Verify OTP to the given MSISDN. The caller must be an
// authenticated user (no anon OTPs — OTP is proof of ownership of the
// number the caller is about to pay to look up).
//
// Rate limits:
//   - pf_verify_otp_phone: 3/day per phone (hard ceiling on OTP $ per phone)
//   - pf_verify_otp_ip:    10/day per IP (bot throttle)
//
// Persisted forensics:
//   - phone_footprint_otp_attempts (one row per send, pending→approved/denied)
//
// Fails CLOSED if Upstash or Supabase is unreachable — Twilio Verify costs
// money and we will not burn budget on a half-broken request path.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkPhoneFootprintRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  hashMsisdn,
  hashIdentifierForPf,
  normalizePhoneE164,
} from "@askarthur/scam-engine/phone-footprint";
import { getUser } from "@/lib/auth";
import { startVerification } from "@/lib/twilioVerify";

export const runtime = "nodejs";
export const maxDuration = 10;

const BodySchema = z.object({
  msisdn: z.string().min(6).max(32),
});

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  // --- Feature flag
  if (!featureFlags.twilioVerifyEnabled) {
    return NextResponse.json(
      { error: "feature_disabled" },
      { status: 503 },
    );
  }

  // --- Auth (must be signed in)
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // --- Parse
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // --- Normalize
  const msisdn = normalizePhoneE164(body.msisdn);
  if (!msisdn) {
    return NextResponse.json({ error: "invalid_msisdn" }, { status: 400 });
  }
  const msisdnHash = hashMsisdn(msisdn);
  const ipHash = hashIdentifierForPf("ip", clientIp(req));

  // --- Rate limits (fail closed in prod)
  const phoneLimit = await checkPhoneFootprintRateLimit("verify_otp_phone", msisdnHash);
  if (!phoneLimit.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited_phone",
        retry_after: phoneLimit.resetAt?.toISOString() ?? null,
      },
      { status: 429 },
    );
  }
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

  // --- Send OTP
  const result = await startVerification(msisdn, {
    userId: user.id,
    requestId: req.headers.get("x-request-id"),
  });

  // --- Log attempt regardless of outcome
  const supa = createServiceClient();
  if (supa) {
    try {
      await supa.from("phone_footprint_otp_attempts").insert({
        msisdn_e164: msisdn,
        msisdn_hash: msisdnHash,
        ip_hash: ipHash,
        user_id: user.id,
        twilio_sid: result.sid ?? null,
        status: result.ok ? "pending" : "error",
        channel: result.channel ?? "sms",
      });
    } catch (err) {
      logger.warn("otp attempt insert failed", { error: String(err) });
    }
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: "verify_start_failed", detail: result.error ?? "unknown" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: result.status,
    channel: result.channel,
  });
}
