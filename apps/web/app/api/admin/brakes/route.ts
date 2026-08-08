// Pull or release a feature brake from /admin/health (#951).
//
// Writes feature_brakes, whose semantics live in isFeatureBraked(): braked ==
// paused_until in the future. "Release" sets paused_until to NOW rather than
// deleting the row, so the audit trail (who braked it, why, when) survives —
// during an incident review that history is the point.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

const Body = z.object({
  feature: z.string().trim().min(2).max(64).regex(/^[a-z0-9_]+$/, "snake_case key expected"),
  action: z.enum(["brake", "release"]),
  /** brake only. Capped at 30 days so a brake can't be forgotten forever. */
  hours: z.number().int().min(1).max(720).optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }
  const { feature, action, hours, reason } = parsed.data;

  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });

  const actor = (await getAdminUserId()) ?? "admin-console";
  const pausedUntil =
    action === "brake"
      ? new Date(Date.now() + (hours ?? 24) * 3600_000).toISOString()
      : new Date().toISOString(); // now = lapsed = inert, row kept for audit

  const { data, error } = await sb
    .from("feature_brakes")
    .upsert(
      {
        feature,
        paused_until: pausedUntil,
        reason:
          action === "brake"
            ? reason || "pulled from /admin/health"
            : reason || "released from /admin/health",
        set_by: actor,
        set_at: new Date().toISOString(),
      },
      { onConflict: "feature" },
    )
    .select("feature, paused_until, reason, set_by")
    .maybeSingle();

  if (error) {
    logger.error("feature_brake_write_failed", { feature, action, error: error.message });
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }

  // warn: halting or resuming a feature is a rare, high-consequence act — it
  // must always reach Axiom, never be sampled away.
  logger.warn("feature_brake_changed", { feature, action, hours: hours ?? null, actor });
  return NextResponse.json({ ok: true, brake: data });
}
