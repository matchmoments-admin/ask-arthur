// POST /api/sim-swap/check
//
// On-demand "is my SIM swapped?" check. Single shared endpoint consumed by:
//   - Web private-beta page at /sim-swap-check
//   - Mobile app SOS button
//   - (PR 8) B2B partner integrations via API key auth
//
// Flow:
//   1. Feature flag gate — NEXT_PUBLIC_FF_SIM_SWAP_ON_DEMAND
//   2. Auth — Supabase session (consumer flow). B2B API key auth deferred
//      to PR 8 (returns 401 if no session for now).
//   3. Validate body — Zod schema for msisdn + optional maxAge.
//   4. Ownership proof — Upstash `pf:owner:{user_id}:{msisdn_hash}` set by
//      the Twilio Verify /verify/check route. 30-day session.
//   5. Cost brake — `feature_brakes.sim_swap` row written by cost-daily-check.
//   6. Per-user rate limit — reuse pf user bucket (60/min) so a runaway loop
//      can't spend the whole credit + Telstra budget before the brake fires.
//   7. Consume credit — atomic `consume_sim_swap_credit` RPC (free → paid
//      priority). On 'no_credits' return 402 + upsell.
//   8. Call Telstra — /check + /retrieve-date in parallel.
//   9. On Telstra failure (5xx throw / "degraded" not-enrolled), refund the
//      credit via `refund_sim_swap_credit` so the user isn't billed for
//      upstream errors.
//  10. Return JSON: { swapped, latestSimChange, monitoredPeriod,
//                     recommendedAction, creditsRemaining, consumedBucket }
//
// Cost telemetry: the Telstra provider writes `telco_api_usage` rows;
// this route ALSO writes a `cost_telemetry` row tagged feature='sim-swap'
// so the cost-daily-check brake sees consolidated spend.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Redis } from "@upstash/redis";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkPhoneFootprintRateLimit } from "@askarthur/utils/rate-limit";
import { logger } from "@askarthur/utils/logger";
import {
  hashMsisdn,
  normalizePhoneE164,
} from "@askarthur/scam-engine/phone-footprint";
import {
  callTelstraSimSwap,
  callTelstraRetrieveDate,
} from "@askarthur/scam-engine/phone-footprint";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { hasRedeemedSimSwapInvite } from "@/lib/simSwapBeta";
import { logCost } from "@/lib/cost-telemetry";

export const runtime = "nodejs";
export const maxDuration = 10;

const OWNERSHIP_SESSION_PREFIX = "pf:owner";
const DEFAULT_MAX_AGE_HOURS = 72; // 3 days — standard bank step-up window.

const RequestBody = z.object({
  msisdn: z.string().min(8).max(20),
  maxAge: z.number().int().min(1).max(2400).optional(),
});

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

async function hasOwnershipProof(
  userId: string,
  msisdnHash: string,
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const v = await redis.get(
      `${OWNERSHIP_SESSION_PREFIX}:${userId}:${msisdnHash}`,
    );
    return v !== null;
  } catch {
    return false;
  }
}

async function isSimSwapBraked(): Promise<boolean> {
  const supa = createServiceClient();
  if (!supa) return false;
  try {
    const { data } = await supa
      .from("feature_brakes")
      .select("paused_until")
      .eq("feature", "sim_swap")
      .maybeSingle();
    if (!data) return false;
    const pausedUntil = data.paused_until
      ? new Date(data.paused_until as string)
      : null;
    return !!(pausedUntil && pausedUntil.getTime() > Date.now());
  } catch {
    return false;
  }
}

interface ConsumeResult {
  consumed_bucket: "free" | "paid";
  free_remaining: number;
  paid_remaining: number;
}

export async function POST(req: NextRequest) {
  // --- (1) Flag gate
  if (!featureFlags.simSwapOnDemand) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }

  // --- (2) Auth
  let user;
  try {
    user = await getUser();
  } catch (err) {
    if (err instanceof AuthUnavailableError) {
      return NextResponse.json(
        { error: "auth_unavailable" },
        { status: 503, headers: { "Retry-After": "30" } },
      );
    }
    throw err;
  }
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // --- (2b) Private-beta invite gate
  if (!(await hasRedeemedSimSwapInvite(user.id))) {
    return NextResponse.json(
      { error: "invite_required" },
      { status: 403 },
    );
  }

  // --- (3) Validate body
  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        detail: err instanceof z.ZodError ? err.flatten() : undefined,
      },
      { status: 400 },
    );
  }

  const msisdn = normalizePhoneE164(body.msisdn);
  if (!msisdn) {
    return NextResponse.json({ error: "invalid_msisdn" }, { status: 400 });
  }
  const maxAge = body.maxAge ?? DEFAULT_MAX_AGE_HOURS;
  const msisdnHash = hashMsisdn(msisdn);
  const requestId =
    req.headers.get("idempotency-key") ??
    req.headers.get("x-request-id") ??
    undefined;

  // --- (4) Ownership proof
  const proven = await hasOwnershipProof(user.id, msisdnHash);
  if (!proven) {
    return NextResponse.json(
      { error: "ownership_not_verified", verifyUrl: "/sim-swap-check/verify" },
      { status: 403 },
    );
  }

  // --- (5) Cost brake
  if (await isSimSwapBraked()) {
    return NextResponse.json(
      { error: "cost_brake_active" },
      { status: 503, headers: { "Retry-After": "3600" } },
    );
  }

  // --- (6) Rate limit (reuse pf:user 60/min/user)
  const rl = await checkPhoneFootprintRateLimit("user", user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.resetAt?.toISOString() ?? null },
      { status: 429 },
    );
  }

  // --- (7) Consume credit (atomic)
  const supa = createServiceClient();
  if (!supa) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  let consume: ConsumeResult;
  try {
    const { data, error } = await supa.rpc("consume_sim_swap_credit", {
      p_user_id: user.id,
    });
    if (error) {
      // PG-encoded RAISE EXCEPTION 'no_credits' surfaces as the message.
      if (error.message?.includes("no_credits") || error.code === "P0001") {
        return NextResponse.json(
          {
            error: "no_credits",
            upsell: {
              creditsPack5: {
                amount: 99,
                currency: "AUD",
                checkoutUrl: "/api/sim-swap/credits/checkout?pack=5",
              },
            },
          },
          { status: 402 },
        );
      }
      logger.error("consume_sim_swap_credit failed", { error });
      return NextResponse.json({ error: "credit_check_failed" }, { status: 500 });
    }
    // RPC returns TABLE(...) → Supabase client gives us the first row.
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      logger.error("consume_sim_swap_credit empty result");
      return NextResponse.json({ error: "credit_check_failed" }, { status: 500 });
    }
    consume = row as ConsumeResult;
  } catch (err) {
    logger.error("consume_sim_swap_credit threw", { error: String(err) });
    return NextResponse.json({ error: "credit_check_failed" }, { status: 500 });
  }

  // --- (8) Call Telstra in parallel
  let telstraOk = false;
  let telstraDegradedReason: string | null = null;
  let telstraError: string | null = null;
  let swapped = false;
  let latestSimChange: string | null = null;
  let monitoredPeriod = 0;

  try {
    const [checkR, dateR] = await Promise.allSettled([
      callTelstraSimSwap(msisdn, { maxAge, userId: user.id }),
      callTelstraRetrieveDate(msisdn, { userId: user.id }),
    ]);

    if (checkR.status !== "fulfilled") {
      telstraError = String(
        (checkR.reason as Error)?.message ?? checkR.reason,
      );
    } else if (checkR.value.kind === "degraded") {
      telstraDegradedReason = checkR.value.reason;
    } else {
      telstraOk = true;
      swapped = checkR.value.swapped;
    }

    if (telstraOk && dateR.status === "fulfilled" && dateR.value.kind === "ok") {
      latestSimChange = dateR.value.latestSimChange;
      monitoredPeriod = dateR.value.monitoredPeriod;
    }
  } catch (err) {
    telstraError = String((err as Error)?.message ?? err);
  }

  // --- (9) Refund credit on upstream failure
  if (!telstraOk) {
    const reason = telstraError ? "refund_telstra_5xx" : "refund_telstra_degraded";
    const refundBucket = consume.consumed_bucket;
    try {
      await supa.rpc("refund_sim_swap_credit", {
        p_user_id: user.id,
        p_bucket: refundBucket,
        p_reason: reason,
      });
    } catch (err) {
      logger.error("refund_sim_swap_credit failed", { error: String(err) });
      // Continue — we still need to tell the user something went wrong.
    }

    if (telstraError) {
      return NextResponse.json(
        {
          error: "telstra_unavailable",
          detail: telstraError.slice(0, 120),
          creditRefunded: true,
        },
        { status: 503 },
      );
    }
    // degraded — typically "not a Telstra subscriber"
    return NextResponse.json(
      {
        error: "carrier_not_covered",
        detail: telstraDegradedReason,
        creditRefunded: true,
      },
      { status: 422 },
    );
  }

  // --- (10) Cost telemetry — single line per successful check so the
  // cost-daily-check brake sees the right number even if the per-call
  // unit_cost in telco_api_usage drifts. $0.12 covers /check + /retrieve-date.
  logCost({
    feature: "sim-swap",
    provider: "telstra",
    operation: "on_demand_check",
    units: 2,
    unitCostUsd: 0.06,
    userId: user.id,
    requestId,
    metadata: {
      msisdn_hash: msisdnHash,
      max_age_hours: maxAge,
      swapped,
      consumed_bucket: consume.consumed_bucket,
    },
  });

  return NextResponse.json(
    {
      swapped,
      latestSimChange,
      monitoredPeriod,
      maxAgeHoursChecked: maxAge,
      recommendedAction: swapped ? "stop" : "proceed",
      consumedBucket: consume.consumed_bucket,
      creditsRemaining: {
        free: consume.free_remaining,
        paid: consume.paid_remaining,
      },
    },
    {
      status: 200,
      headers: requestId ? { "X-Request-Id": requestId } : undefined,
    },
  );
}
