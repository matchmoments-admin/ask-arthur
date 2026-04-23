import "server-only";

// Twilio Verify wrapper — OTP send + check for Phone Footprint ownership
// proof (APP 3.5/3.6 compliance spine).
//
// Setup prerequisite (one-time, not in code):
//   1. In Twilio console → Verify → create a Verify Service.
//   2. Put the Service SID in env: TWILIO_VERIFY_SERVICE_SID.
//
// Auth reuses the existing TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN already
// present for Lookup v2 — no new Twilio credentials required.
//
// Cost: AU SMS ~$0.10 per successful verification (list), more for repeat
// attempts. Logged to cost_telemetry via logCost so it shows up on the
// admin /costs dashboard under feature="phone_footprint",
// provider="twilio_verify".

import Twilio from "twilio";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

let _client: ReturnType<typeof Twilio> | null = null;

function getClient() {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("Twilio credentials not configured");
  }
  _client = Twilio(sid, token);
  return _client;
}

function getServiceSid(): string {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid) {
    throw new Error("TWILIO_VERIFY_SERVICE_SID not configured");
  }
  return sid;
}

export interface StartVerificationResult {
  ok: boolean;
  sid?: string;
  status?: string; // 'pending' | 'approved' | 'canceled'
  channel?: string; // 'sms' | 'call'
  error?: string;
}

/**
 * Send an OTP to the given MSISDN via Twilio Verify.
 * Caller is responsible for:
 *   - Feature flag check (FF_TWILIO_VERIFY_ENABLED).
 *   - Rate limits (pf_verify_otp_phone, pf_verify_otp_ip).
 *   - Writing the attempt row to phone_footprint_otp_attempts.
 */
export async function startVerification(
  msisdnE164: string,
  opts: { userId?: string | null; requestId?: string | null } = {},
): Promise<StartVerificationResult> {
  try {
    const v = await getClient()
      .verify.v2.services(getServiceSid())
      .verifications.create({ to: msisdnE164, channel: "sms" });

    logCost({
      feature: "phone_footprint",
      provider: "twilio_verify",
      operation: "send_sms",
      units: 1,
      unitCostUsd: 0.1,
      metadata: { channel: "sms", status: v.status, msisdn_suffix: msisdnE164.slice(-4) },
      userId: opts.userId ?? null,
      requestId: opts.requestId ?? null,
    });

    return {
      ok: true,
      sid: v.sid,
      status: v.status ?? "pending",
      channel: v.channel ?? "sms",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("twilioVerify.startVerification failed", {
      error: msg,
      msisdn_suffix: msisdnE164.slice(-4),
    });
    return { ok: false, error: msg };
  }
}

export interface CheckVerificationResult {
  approved: boolean;
  sid?: string;
  status?: string;
  error?: string;
}

/**
 * Validate an OTP submitted by the user. Returns approved=true only when
 * the status is 'approved'. Wrong codes return approved=false without
 * throwing; rate-limit / service errors return an error string.
 */
export async function checkVerification(
  msisdnE164: string,
  code: string,
): Promise<CheckVerificationResult> {
  try {
    const check = await getClient()
      .verify.v2.services(getServiceSid())
      .verificationChecks.create({ to: msisdnE164, code });

    return {
      approved: check.status === "approved",
      sid: check.sid,
      status: check.status ?? "unknown",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("twilioVerify.checkVerification failed", {
      error: msg,
      msisdn_suffix: msisdnE164.slice(-4),
    });
    return { approved: false, error: msg };
  }
}
