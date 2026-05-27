import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { CLONE_WATCH_TRIAGED_EVENT } from "@askarthur/scam-engine/inngest/events";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

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
  //
  // Hardening 2026-05-27: a brief Inngest cloud blip at 08:38 UTC silently
  // dropped the event for alert 487. The triage RPC succeeded (alert marked
  // tp_confirmed) but no downstream processing fired and the admin saw no
  // batch in approvals — looked exactly like the click had failed.
  //
  // Defence:
  //   * Retry inngest.send up to 3 times with exponential backoff (200ms,
  //     400ms, 800ms). Total tail-latency cap on failure is ~1.4s.
  //   * If all attempts fail: send a Telegram alert to admin chat so the
  //     drop is visible immediately, not buried in logger.error.
  //   * Return `eventEmitted: false` on the response so the dashboard can
  //     surface a warning toast (informational, the triage itself succeeded).
  let eventEmitted = true;
  if (parsed.status === "tp_confirmed") {
    const signal = Array.isArray(alert.signals) ? alert.signals[0] : null;
    const eventPayload = {
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
    };
    const result = await sendEventWithRetry(eventPayload, 3);
    if (!result.ok) {
      eventEmitted = false;
      logger.error("clone-watch triage: event emit failed after retries", {
        alertId: alert.id,
        attempts: result.attempts,
        error: result.lastError,
      });
      // Page admin so the drop isn't silent. Same Telegram chat as the
      // weekly digest + brand-notification approvals.
      try {
        await sendAdminTelegramMessage(
          [
            `⚠️ <b>Clone-watch triage event drop</b>`,
            ``,
            `Alert <code>${alert.id}</code> (${escapeHtml(alert.inferred_target_domain)} / ${escapeHtml(alert.candidate_domain)}) was marked tp_confirmed but the downstream Inngest event failed after ${result.attempts} attempts.`,
            ``,
            `Last error: <code>${escapeHtml(result.lastError ?? "unknown")}</code>`,
            ``,
            `<b>No Netcraft submission, no brand notification.</b> Retry by re-triaging the row from /admin/clone-watch (set to needs_investigation then back to tp_confirmed).`,
          ].join("\n"),
        );
      } catch (telegramErr) {
        logger.error("clone-watch triage: telegram alert also failed", {
          alertId: alert.id,
          error:
            telegramErr instanceof Error
              ? telegramErr.message
              : String(telegramErr),
        });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    alert: data,
    eventEmitted,
  });
}

// ── Pure helpers (exported for unit testing) ─────────────────────────────

interface SendEventResult {
  ok: boolean;
  attempts: number;
  lastError?: string;
}

/**
 * Send an Inngest event with bounded retry on transient failures. Stops
 * after `maxAttempts` total attempts (incl. the first). Exponential
 * backoff: 200ms, 400ms, 800ms, ...
 *
 * Designed to defend against the 2026-05-27 silent-drop pattern: brief
 * Inngest cloud blips that dropped a single event in an otherwise-healthy
 * window. Idempotency on the consumer side (`idempotency: event.data.alertId`)
 * means double-fire on retry is safe.
 */
export async function sendEventWithRetry(
  payload: Parameters<typeof inngest.send>[0],
  maxAttempts = 3,
): Promise<SendEventResult> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await inngest.send(payload);
      return { ok: true, attempts: attempt };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
      }
    }
  }
  return { ok: false, attempts: maxAttempts, lastError };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
