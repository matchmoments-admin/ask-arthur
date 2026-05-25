import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_SCAN_REQUESTED_EVENT } from "@askarthur/scam-engine/inngest/events";

const BodySchema = z.object({
  alertId: z.number().int().positive(),
});

export const dynamic = "force-dynamic";

/**
 * Admin "Scan now" — emit a shopfront/clone.scan-requested.v1 event for the
 * given alert. Used to:
 *  - Smoke-test the urlscan path before flipping FF on broadly
 *  - Manually re-scan a row when the operator wants a fresh result
 *
 * Gated on FF_SHOPFRONT_CLONE_URLSCAN (so the downstream consumer doesn't
 * silently skip), requireAdmin (HMAC cookie or Supabase auth admin).
 */
export async function POST(req: Request) {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneUrlscan) {
    return NextResponse.json(
      { error: "urlscan_disabled" },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        details: err instanceof Error ? err.message : "validation failed",
      },
      { status: 400 },
    );
  }

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json(
      { error: "supabase_unavailable" },
      { status: 503 },
    );
  }

  const { data: alert, error } = await sb
    .from("shopfront_clone_alerts")
    .select("id, candidate_url, candidate_domain")
    .eq("id", parsed.alertId)
    .maybeSingle();

  if (error) {
    logger.error("admin scan: load failed", {
      alertId: parsed.alertId,
      error: error.message,
    });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  if (!alert) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    await inngest.send({
      name: CLONE_WATCH_SCAN_REQUESTED_EVENT,
      // Unique id per manual trigger so the per-fn idempotency doesn't
      // collide with the initial scan
      id: `clone-watch-urlscan-admin:${alert.id}:${Date.now()}`,
      data: {
        alertId: alert.id,
        candidateUrl: alert.candidate_url,
        candidateDomain: alert.candidate_domain,
        reason: "rescan" as const,
      },
    });
  } catch (err) {
    logger.error("admin scan: event emit failed", {
      alertId: alert.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "event_emit_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    alertId: alert.id,
    candidateDomain: alert.candidate_domain,
    enqueued: true,
  });
}
