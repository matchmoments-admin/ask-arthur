import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { logCost, claudeHaikuCostUsd, PRICING } from "@/lib/cost-telemetry";
import { sendForwardCheckReply } from "@/lib/resend";
import { readNumberEnv } from "@/lib/env-coerce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude calls can tail to ~15s on the analyze path; reply email is another
// 1–3s. 30s upper bound matches /api/analyze.
export const maxDuration = 30;

// ── Payload schema ──────────────────────────────────────────────────────
//
// Mirrors the shape the Cloudflare Email Worker POSTs. Same fields as the
// intel-inbound-email payload, minus the source enum (this route only
// receives one source value, hard-coded by the worker).
const ForwardCheckPayload = z.object({
  source: z.literal("user_forward_check"),
  external_id: z.string().min(8).max(128),
  subject: z.string().min(1).max(2000),
  body_md: z.string().min(1).max(50_000),
  url: z.string().url().optional(),
  from: z.string().email().max(320),
  to: z.string().min(3).max(320),
  received_at: z.string().datetime(),
});
type ForwardCheckPayload = z.infer<typeof ForwardCheckPayload>;

// Constant-time secret compare. The shared INBOUND_EMAIL_WEBHOOK_SECRET is
// the same value the existing intel-inbound-email edge function uses;
// reusing it means one secret rotation operation covers both endpoints.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// Per-sender daily cap. Stops the cheap "I forward 1000 newsletters to your
// inbox to drain your Claude budget" abuse pattern. 100/day is enough for
// the most aggressive legitimate user (forwarding every newsletter they
// receive) and well under the $5/day spend cap (~1000 calls at $0.005).
const PER_SENDER_DAILY_CAP = 100;

export async function POST(req: Request) {
  // ── Kill switch ──
  // Off by default until the user confirms the Cloudflare routing rule for
  // check@askarthur-inbound.com and adds EMAIL_FORWARD_CHECK_URL to the
  // Worker's wrangler secrets. The worker drops silently when this returns
  // 204 (matches the intel-inbound-email kill-switch contract).
  if (process.env.ENABLE_EMAIL_FORWARD_CHECK !== "true") {
    return new Response(null, { status: 204 });
  }

  // ── Auth ──
  const expectedSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET ?? "";
  const providedSecret = req.headers.get("x-webhook-secret") ?? "";
  if (!expectedSecret || !timingSafeEqual(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ── Parse ──
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = ForwardCheckPayload.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const payload: ForwardCheckPayload = parsed.data;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // ── Feature-brake check ──
  // If cost-daily-check has paused this feature for the day, reject before
  // we spend any Claude tokens. 503 + Retry-After so the operator (or the
  // worker's quarantine path) can detect it. Don't send a reply email in
  // this state — that's the whole point of the brake.
  const { data: brakeRow } = await supabase
    .from("feature_brakes")
    .select("paused_until, reason")
    .eq("feature", "email_forward_check")
    .gt("paused_until", new Date().toISOString())
    .maybeSingle();
  if (brakeRow?.paused_until) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil(
        (new Date(brakeRow.paused_until as string).getTime() - Date.now()) / 1000,
      ),
    );
    logger.warn("email_forward_check brake active — rejecting", { reason: brakeRow.reason });
    return new Response(JSON.stringify({ error: "paused", reason: brakeRow.reason }), {
      status: 503,
      headers: { "content-type": "application/json", "retry-after": String(retryAfterSec) },
    });
  }

  // ── Per-sender rate limit ──
  // Cheap count(*) against the from-email/created-at index. Doing this
  // before the insert keeps the request idempotent on retries — a repeated
  // delivery for the same external_id hits the UNIQUE constraint below,
  // not the rate-limit gate.
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: senderCount } = await supabase
    .from("email_forward_checks")
    .select("id", { count: "exact", head: true })
    .eq("from_email", payload.from)
    .gte("created_at", since24h);
  if ((senderCount ?? 0) >= PER_SENDER_DAILY_CAP) {
    logger.warn("email_forward_check: per-sender daily cap exceeded", {
      from: payload.from,
      count: senderCount,
    });
    // Best-effort over-cap reply so the sender knows why nothing's
    // arriving. Bypasses the Claude call entirely.
    await sendForwardCheckReply({
      toEmail: payload.from,
      originalSubject: payload.subject,
      verdict: "UNCERTAIN",
      reasoning:
        `We've received ${senderCount} emails from your address in the last 24 hours, ` +
        `which is over our per-sender daily limit. We'll resume analysing your forwards ` +
        `tomorrow. If this looks wrong, reply to this email or report it at askarthur.au.`,
    }).catch(() => {});
    return NextResponse.json({ status: "rate_limited" }, { status: 429 });
  }

  // ── Insert pending row ──
  // Idempotency: same Cloudflare retry never doubles the Claude bill. We
  // INSERT with the unique constraint and treat 23505 as "duplicate, drop"
  // — same shape as the intel-inbound-email function.
  const { data: insertRow, error: insertError } = await supabase
    .from("email_forward_checks")
    .insert({
      external_id: payload.external_id,
      from_email: payload.from,
      subject: payload.subject,
      body_md: payload.body_md,
      url: payload.url ?? null,
      received_at: payload.received_at,
    })
    .select("id")
    .maybeSingle();
  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ status: "duplicate" }, { status: 200 });
    }
    logger.error("email_forward_check: insert failed", { error: insertError.message });
    return NextResponse.json({ error: "db_write_failed" }, { status: 500 });
  }
  const rowId = insertRow?.id as number | undefined;

  // ── Analyze ──
  // Reuse the same analyzeWithClaude path the consumer /api/analyze surface
  // uses — PII scrub, prompt-injection sandwich, JSON prefill, etc. The
  // forwarded body is the only input; we don't have images or redirect
  // chains in the inbound-email pipeline.
  let analysis: Awaited<ReturnType<typeof analyzeWithClaude>> | null = null;
  let analyzeError: string | null = null;
  try {
    analysis = await analyzeWithClaude(payload.body_md);
  } catch (err) {
    analyzeError = err instanceof Error ? err.message : String(err);
    logger.error("email_forward_check: analyze failed", { error: analyzeError });
  }

  // Per-row cost. Claude usage is on AnalysisResult.usage; we sum
  // Haiku 4.5 input + output. Reply email cost added after the send.
  const claudeCostUsd =
    analysis?.usage != null
      ? claudeHaikuCostUsd(analysis.usage.inputTokens, analysis.usage.outputTokens)
      : 0;

  if (!analysis) {
    // Persist the failure so the row isn't a phantom "received but no verdict".
    await supabase
      .from("email_forward_checks")
      .update({
        reply_error: `analyze_failed: ${analyzeError ?? "unknown"}`,
        cost_usd: claudeCostUsd,
      })
      .eq("id", rowId ?? 0);
    return NextResponse.json({ error: "analyze_failed" }, { status: 502 });
  }

  // Cost telemetry — single source of truth for spend tracking. The
  // cost-daily-check cron sums these rows; the admin /admin/costs page
  // displays them. Without this row, the brake never trips and the
  // dashboard shows $0 for the feature.
  logCost({
    feature: "email-forward-check",
    provider: "anthropic",
    operation: "haiku-4-5",
    units: analysis.usage?.inputTokens ?? 0,
    estimatedCostUsd: claudeCostUsd,
    metadata: {
      verdict: analysis.verdict,
      output_tokens: analysis.usage?.outputTokens ?? 0,
      external_id: payload.external_id,
    },
  });

  // ── Reply email ──
  const reply = await sendForwardCheckReply({
    toEmail: payload.from,
    originalSubject: payload.subject,
    verdict: analysis.verdict,
    reasoning: analysis.summary,
    confidence: analysis.confidence,
  });

  // ── Persist the verdict + reply outcome ──
  const replyCostUsd = reply.ok ? PRICING.RESEND_USD_PER_EMAIL : 0;
  await supabase
    .from("email_forward_checks")
    .update({
      verdict: analysis.verdict,
      verdict_confidence: analysis.confidence,
      reasoning: analysis.summary,
      cost_usd: claudeCostUsd + replyCostUsd,
      reply_sent_at: reply.ok ? new Date().toISOString() : null,
      reply_error: reply.ok ? null : reply.error?.slice(0, 500),
    })
    .eq("id", rowId ?? 0);

  // ── Daily-spend cap (set brake on the way out) ──
  // Read today's email-forward-check spend AFTER our own cost row landed.
  // If we just pushed it past the cap, write a feature_brakes row so the
  // NEXT inbound check returns 503. We don't reject the current request
  // (the reply has already been sent) — only protect future spend.
  const capUsd = readNumberEnv("EMAIL_FORWARD_CHECK_CAP_USD", 5).value;
  const todayStartIso = new Date(
    new Date().toISOString().slice(0, 10) + "T00:00:00.000Z",
  ).toISOString();
  const { data: spendRows } = await supabase
    .from("cost_telemetry")
    .select("estimated_cost_usd")
    .eq("feature", "email-forward-check")
    .gte("created_at", todayStartIso);
  const todaySpendUsd = (spendRows ?? []).reduce(
    (sum, r) => sum + Number(r.estimated_cost_usd ?? 0),
    0,
  );
  if (todaySpendUsd > capUsd) {
    const pausedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error: brakeError } = await supabase.from("feature_brakes").upsert(
      {
        feature: "email_forward_check",
        paused_until: pausedUntil,
        reason: `Daily spend $${todaySpendUsd.toFixed(4)} exceeded $${capUsd} cap`,
        set_by: "email-forward-check-route",
        set_cost_usd: todaySpendUsd,
        set_threshold_usd: capUsd,
        set_at: new Date().toISOString(),
      },
      { onConflict: "feature" },
    );
    if (brakeError) {
      logger.error("email_forward_check: brake upsert failed", { error: brakeError.message });
    } else {
      logger.warn("email_forward_check: brake engaged", { todaySpendUsd, capUsd });
    }
  }

  return NextResponse.json(
    {
      status: reply.ok ? "replied" : "analyzed_but_reply_failed",
      verdict: analysis.verdict,
      external_id: payload.external_id,
    },
    { status: 200 },
  );
}
