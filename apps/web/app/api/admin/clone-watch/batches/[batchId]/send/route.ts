import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";

// POST /api/admin/clone-watch/batches/[batchId]/send
//
// Dashboard-driven approval: the admin clicks "Send" on a pending batch
// in /admin/clone-watch#approvals → we load the frozen email subject + body
// from the queue, send via Resend, transition the batch to 'sent'.
//
// Replaces the HMAC-URL approve-batch route that was auto-clicked by
// Telegram's link-preview crawler (incident 2026-05-26).

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL ?? "Ask Arthur <brendan@askarthur.au>";
const REPLY_TO_EMAIL = "brendan@askarthur.au";

interface BatchRow {
  id: number;
  alert_id: number;
  brand: string;
  candidate_domain: string;
  recipient: string;
  channel_type: string;
  approval_status: string;
  email_subject: string | null;
  email_body_html: string | null;
}

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> },
) {
  await requireAdmin();

  if (!featureFlags.shopfrontCloneOutreach) {
    return NextResponse.json(
      { error: "clone_outreach_disabled" },
      { status: 503 },
    );
  }

  const { batchId } = await ctx.params;
  if (!batchId) {
    return NextResponse.json({ error: "missing_batch_id" }, { status: 400 });
  }

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json(
      { error: "supabase_unavailable" },
      { status: 503 },
    );
  }

  const { data: rows, error: loadErr } = await sb.rpc("load_clone_alert_batch", {
    p_batch_id: batchId,
  });
  if (loadErr) {
    logger.error("clone-watch send: load failed", {
      batchId,
      error: loadErr.message,
    });
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
  const batch = (rows as BatchRow[] | null) ?? [];
  if (batch.length === 0) {
    return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  }

  const first = batch[0];

  // Idempotent terminal states
  if (first.approval_status === "sent") {
    return NextResponse.json({
      ok: true,
      alreadySent: true,
      batchId,
    });
  }
  if (first.approval_status === "rejected") {
    return NextResponse.json(
      { error: "already_rejected" },
      { status: 409 },
    );
  }
  if (first.approval_status === "expired") {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  if (
    first.approval_status !== "pending" &&
    first.approval_status !== "approved" &&
    first.approval_status !== "auto_approved"
  ) {
    return NextResponse.json(
      { error: "invalid_state", state: first.approval_status },
      { status: 400 },
    );
  }
  if (!first.email_subject || !first.email_body_html) {
    return NextResponse.json(
      { error: "missing_payload" },
      { status: 500 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "resend_not_configured" },
      { status: 503 },
    );
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [first.recipient],
      replyTo: REPLY_TO_EMAIL,
      subject: first.email_subject,
      html: first.email_body_html,
    });
    if (result.error) {
      throw new Error(
        `Resend rejected: ${result.error.message ?? String(result.error)}`,
      );
    }
    const providerMessageId = result.data?.id ?? null;

    const { error: transErr } = await sb.rpc("transition_clone_alert_batch", {
      p_batch_id: batchId,
      p_new_status: "sent",
      p_provider_message_id: providerMessageId,
    });
    if (transErr) {
      logger.error("clone-watch send: transition failed", {
        batchId,
        error: transErr.message,
      });
      return NextResponse.json(
        { error: "transition_failed", details: transErr.message },
        { status: 500 },
      );
    }

    logCost({
      feature: "shopfront_clone_notify_brand",
      provider: "resend",
      operation: "dashboard_send",
      units: 1,
      unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
      metadata: {
        batch_id: batchId,
        brand: first.brand,
        recipient: first.recipient,
        candidate_count: batch.length,
        provider_message_id: providerMessageId,
      },
    });

    logger.info("clone-watch send: sent", {
      batchId,
      brand: first.brand,
      recipient: first.recipient,
      candidates: batch.length,
      providerMessageId,
    });

    return NextResponse.json({
      ok: true,
      batchId,
      brand: first.brand,
      recipient: first.recipient,
      candidates: batch.length,
      providerMessageId,
    });
  } catch (err) {
    logger.error("clone-watch send: failed", {
      batchId,
      error: String(err),
    });
    return NextResponse.json(
      { error: "send_failed", details: String(err) },
      { status: 500 },
    );
  }
}
