// /api/phone-footprint/monitors/[id] — read, patch, delete.
//
// Read: full monitor row + linked latest_footprint snapshot for UI display.
// Patch: caller can edit alias, refresh_cadence (within entitlement
//   bounds), alert_threshold. CANNOT change msisdn or scope (security).
// Delete: soft-delete (sets soft_deleted_at). Hard delete cascades via
//   the retention sweep. This way alerts stay queryable for audit trail.

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";

const PatchBody = z
  .object({
    alias: z.string().max(120).nullable().optional(),
    refresh_cadence: z.enum(["weekly", "monthly", "daily"]).optional(),
    alert_threshold: z.number().int().min(1).max(100).optional(),
    status: z.enum(["active", "paused"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "no fields to update" });

async function loadOwned(
  monitorId: number,
  userId: string,
): Promise<{ id: number; user_id: string | null; org_id: string | null } | null> {
  const supa = createServiceClient();
  if (!supa) return null;
  const { data, error } = await supa
    .from("phone_footprint_monitors")
    .select("id, user_id, org_id, soft_deleted_at")
    .eq("id", monitorId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.soft_deleted_at) return null;
  if (data.user_id !== userId) return null;
  return { id: data.id, user_id: data.user_id, org_id: data.org_id };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const monitorId = Number.parseInt(id, 10);
  if (!Number.isInteger(monitorId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const owned = await loadOwned(monitorId, user.id);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supa = createServiceClient()!;
  const { data, error } = await supa
    .from("phone_footprint_monitors")
    .select(
      `id, msisdn_e164, alias, scope, tier, refresh_cadence, alert_threshold,
       last_refreshed_at, next_refresh_at, status, created_at, last_footprint_id,
       consent_granted_at, consent_expires_at`,
    )
    .eq("id", monitorId)
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "lookup_failed" }, { status: 500 });

  // Pull the latest footprint snapshot so the UI can render the score
  // without a second round-trip. Cheap join on a single PK.
  let latestFootprint = null;
  if (data.last_footprint_id) {
    const { data: fp } = await supa
      .from("phone_footprints")
      .select("id, composite_score, band, generated_at, expires_at, coverage")
      .eq("id", data.last_footprint_id)
      .maybeSingle();
    latestFootprint = fp ?? null;
  }

  // Recent alerts (last 10) for the UI tail.
  const { data: alerts } = await supa
    .from("phone_footprint_alerts")
    .select("id, alert_type, severity, created_at, delivered_at, delivered_channels")
    .eq("monitor_id", monitorId)
    .order("created_at", { ascending: false })
    .limit(10);

  return NextResponse.json({
    monitor: data,
    latest_footprint: latestFootprint,
    recent_alerts: alerts ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const monitorId = Number.parseInt(id, 10);
  if (!Number.isInteger(monitorId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const owned = await loadOwned(monitorId, user.id);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const supa = createServiceClient()!;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.alias !== undefined) update.alias = body.alias;
  if (body.refresh_cadence) update.refresh_cadence = body.refresh_cadence;
  if (body.alert_threshold !== undefined) update.alert_threshold = body.alert_threshold;
  if (body.status) update.status = body.status;

  const { data, error } = await supa
    .from("phone_footprint_monitors")
    .update(update)
    .eq("id", monitorId)
    .select("id, alias, refresh_cadence, alert_threshold, status, updated_at")
    .single();

  if (error) {
    logger.error("monitor PATCH failed", { error: String(error.message) });
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  return NextResponse.json({ monitor: data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!featureFlags.phoneFootprintConsumer) {
    return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
  }
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const monitorId = Number.parseInt(id, 10);
  if (!Number.isInteger(monitorId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const owned = await loadOwned(monitorId, user.id);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const supa = createServiceClient()!;

  // Soft-delete the monitor so alerts remain auditable. Also delete the
  // queued refresh row so the cron stops touching this monitor.
  const { error } = await supa
    .from("phone_footprint_monitors")
    .update({
      status: "revoked",
      soft_deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", monitorId);

  if (error) {
    logger.error("monitor DELETE failed", { error: String(error.message) });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  await supa
    .from("phone_footprint_refresh_queue")
    .delete()
    .eq("monitor_id", monitorId);

  return NextResponse.json({ deleted: true, monitor_id: monitorId });
}
