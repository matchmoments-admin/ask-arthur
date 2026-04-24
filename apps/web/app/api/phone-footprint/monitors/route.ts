// /api/phone-footprint/monitors — list + create.
//
// GET: returns the caller's active monitors (user-owned + org-fleet rows
// where the caller is an org member).
// POST: create a new monitor for the caller. Requires:
//   - Authenticated user
//   - OTP-verified ownership of the MSISDN (Upstash session flag from
//     /verify/check) — the APP 3.5 self-lookup gate
//   - Entitlement headroom: phone_footprint_entitlements.saved_numbers_limit
//     not exceeded (counts only active, non-soft-deleted monitors)
//
// All gated by NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER. With the flag off
// returns 503.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Redis } from "@upstash/redis";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkPhoneFootprintRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  hashMsisdn,
  normalizePhoneE164,
} from "@askarthur/scam-engine/phone-footprint";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 10;

const OWNERSHIP_SESSION_PREFIX = "pf:owner";

const CreateBody = z.object({
  msisdn: z.string().min(6).max(32),
  alias: z.string().max(120).optional(),
  refresh_cadence: z.enum(["weekly", "monthly"]).optional(),
  alert_threshold: z.number().int().min(1).max(100).optional(),
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
    const v = await redis.get(`${OWNERSHIP_SESSION_PREFIX}:${userId}:${msisdnHash}`);
    return v !== null;
  } catch {
    return false;
  }
}

// =============================================================================
// GET — list monitors
// =============================================================================
export async function GET(_req: NextRequest) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supa = createServiceClient();
  if (!supa) return NextResponse.json({ error: "supabase_unavailable" }, { status: 500 });

  // User-owned monitors (consumer scope). Org-fleet monitors are listed
  // separately under /api/org/[orgId]/phone-footprint/monitors so the
  // /app dashboard surface is uncluttered for individual users.
  const { data, error } = await supa
    .from("phone_footprint_monitors")
    .select(
      "id, msisdn_e164, alias, scope, tier, refresh_cadence, alert_threshold, last_refreshed_at, next_refresh_at, status, created_at, last_footprint_id",
    )
    .eq("user_id", user.id)
    .is("soft_deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("monitors GET failed", { error: String(error.message) });
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  return NextResponse.json({ monitors: data ?? [] });
}

// =============================================================================
// POST — create monitor
// =============================================================================
export async function POST(req: NextRequest) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Cheap rate limit on the user bucket — monitor creation is bursty
  // (signup flow) but a stuck client retrying could fan out a lot of OTPs.
  const rl = await checkPhoneFootprintRateLimit("user", user.id);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retry_after: rl.resetAt?.toISOString() ?? null },
      { status: 429 },
    );
  }

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const msisdn = normalizePhoneE164(body.msisdn);
  if (!msisdn) return NextResponse.json({ error: "invalid_msisdn" }, { status: 400 });
  const msisdnHash = hashMsisdn(msisdn);

  // OTP gate — APP 3.5 self-lookup spine. A monitor is a long-running
  // commitment to refresh + alert; we will not create one without proof
  // the caller controls the number.
  const proven = await hasOwnershipProof(user.id, msisdnHash);
  if (!proven) {
    return NextResponse.json(
      { error: "ownership_required", message: "Verify ownership of this number first via /verify/start." },
      { status: 403 },
    );
  }

  const supa = createServiceClient();
  if (!supa) return NextResponse.json({ error: "supabase_unavailable" }, { status: 500 });

  // Entitlement check: count current active monitors for this user, compare
  // against entitlement.saved_numbers_limit. If user has no entitlement
  // row, default to 1 (Free tier — own number only).
  const { data: ent } = await supa
    .from("phone_footprint_entitlements")
    .select("saved_numbers_limit, status, refresh_cadence_min")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const limit = ent?.saved_numbers_limit ?? 1;
  const minCadence = (ent?.refresh_cadence_min ?? "monthly") as
    | "daily"
    | "weekly"
    | "monthly";

  const { count } = await supa
    .from("phone_footprint_monitors")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("soft_deleted_at", null);

  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      {
        error: "saved_numbers_limit_reached",
        current: count ?? 0,
        limit,
        upgrade_to: "Footprint Personal or Family",
      },
      { status: 402 },
    );
  }

  // Cadence is bounded by the entitlement: a Free tier user can't request
  // 'daily' even if they pass it in the body. Take the stricter of (body,
  // entitlement minimum).
  const requestedCadence = body.refresh_cadence ?? "monthly";
  const cadence = strictestCadence(requestedCadence, minCadence);

  const { data: inserted, error: insErr } = await supa
    .from("phone_footprint_monitors")
    .insert({
      user_id: user.id,
      msisdn_e164: msisdn,
      msisdn_hash: msisdnHash,
      alias: body.alias ?? null,
      scope: "self",
      ownership_proof: { method: "otp_session", verified_at: new Date().toISOString() },
      tier: ent ? "full" : "basic",
      refresh_cadence: cadence,
      alert_threshold: body.alert_threshold ?? 15,
      // Schedule the first refresh ~1 hour out so any in-flight footprint
      // generation finishes first; subsequent refreshes use the cadence.
      next_refresh_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select("id, msisdn_e164, alias, refresh_cadence, alert_threshold, next_refresh_at, status, created_at")
    .single();

  if (insErr) {
    if (insErr.code === "23505") {
      return NextResponse.json(
        { error: "monitor_exists", message: "You already have an active monitor for this number." },
        { status: 409 },
      );
    }
    logger.error("monitor insert failed", { error: String(insErr.message) });
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  // Seed the refresh queue so the cron picks it up at next_refresh_at.
  await supa
    .from("phone_footprint_refresh_queue")
    .insert({
      monitor_id: inserted.id,
      scheduled_for: inserted.next_refresh_at,
    })
    .select("id")
    .maybeSingle();

  return NextResponse.json({ monitor: inserted }, { status: 201 });
}

// "Stricter" = shorter interval. weekly is stricter than monthly, daily
// is strictest of all. Used to cap a user's requested cadence by their
// entitlement minimum.
function strictestCadence(
  a: "daily" | "weekly" | "monthly",
  b: "daily" | "weekly" | "monthly",
): "daily" | "weekly" | "monthly" {
  const order = { daily: 0, weekly: 1, monthly: 2 } as const;
  return order[a] < order[b] ? a : b;
}
