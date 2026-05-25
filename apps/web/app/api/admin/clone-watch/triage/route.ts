import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_TRIAGED_EVENT } from "@askarthur/scam-engine/inngest/events";

const TriageBodySchema = z.object({
  alertId: z.number().int().positive(),
  status: z.enum(["tp_confirmed", "fp", "needs_investigation", "tp_actioned"]),
  notes: z.string().max(1000).optional(),
});

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneOutreach) {
    return NextResponse.json(
      { error: "clone_outreach_disabled" },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = TriageBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_body",
        details: err instanceof Error ? err.message : "validation failed",
      },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "supabase_unavailable" },
      { status: 503 },
    );
  }

  // Load the alert for the event payload BEFORE we update — we need the
  // brand + candidate URL to fan out downstream consumers.
  const { data: alert, error: loadErr } = await supabase
    .from("shopfront_clone_alerts")
    .select(
      "id, inferred_target_domain, candidate_domain, candidate_url, severity_tier, signals",
    )
    .eq("id", parsed.alertId)
    .maybeSingle();

  if (loadErr) {
    logger.error("clone-watch triage: load failed", {
      alertId: parsed.alertId,
      error: loadErr.message,
    });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  if (!alert) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data, error } = await supabase.rpc("set_clone_alert_triage", {
    p_alert_id: parsed.alertId,
    p_status: parsed.status,
    p_admin_id: null, // HMAC admin: no Supabase user_id; null is fine
    p_notes: parsed.notes ?? null,
  });

  if (error) {
    logger.error("clone-watch triage: rpc failed", {
      alertId: parsed.alertId,
      error: error.message,
    });
    return NextResponse.json({ error: "triage_failed" }, { status: 500 });
  }

  // Fan-out: emit event ONLY for tp_confirmed. The downstream consumers
  // (Netcraft submit, brand notify) check their own feature flags + API key
  // presence and gracefully no-op when unavailable.
  if (parsed.status === "tp_confirmed") {
    try {
      const signal = Array.isArray(alert.signals) ? alert.signals[0] : null;
      await inngest.send({
        name: CLONE_WATCH_TRIAGED_EVENT,
        id: `clone-watch-triage:${alert.id}`,
        data: {
          alertId: alert.id,
          brand: alert.inferred_target_domain,
          candidateDomain: alert.candidate_domain,
          candidateUrl: alert.candidate_url,
          severityTier: alert.severity_tier,
          signalType:
            (signal &&
              typeof signal === "object" &&
              "signal_type" in signal &&
              typeof signal.signal_type === "string"
              ? signal.signal_type
              : "unknown") as string,
          score:
            (signal &&
              typeof signal === "object" &&
              "score" in signal &&
              typeof signal.score === "number"
              ? signal.score
              : 0) as number,
          triagedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      logger.error("clone-watch triage: event emit failed", {
        alertId: alert.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't fail the triage — the row is correctly marked.
      // Operator can re-trigger via /admin/clone-watch retry button (future).
    }
  }

  return NextResponse.json({
    ok: true,
    alert: data,
  });
}
