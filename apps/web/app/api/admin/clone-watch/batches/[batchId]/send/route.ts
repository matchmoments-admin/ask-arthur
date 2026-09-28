import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import {
  createBrandSendGate,
  refusalStatus,
  type BrandSendRefusal,
} from "@/lib/clone-watch/brand-send-gate";

// POST /api/admin/clone-watch/batches/[batchId]/send
//
// Dashboard-driven approval: the admin clicks "Send" on a pending batch
// in /admin/clone-watch#approvals → we load the frozen email subject + body
// from the queue, send via Resend with an idempotency key, transition the
// batch to 'sent', and stamp brand_contact_directory.last_notified_at +
// shopfront_clone_alerts.submitted_to.brand_notification.status='sent'.
//
// Every precondition below the admin check is the Brand Send Gate's "batch"
// profile (lib/clone-watch/brand-send-gate.ts) — this route no longer
// carries its own copy of the conjunction (PR-C, 2026-09-28; it gained the
// brand_report_unsubscribes check it was missing).
//
// Hardening pass v152 (2026-05-27):
//   • Re-check FF_SHOPFRONT_CLONE_NOTIFY_BRAND (was only checking the
//     master outreach flag — a stale batch could still ship after a flag
//     flip).
//   • Pre-check feature_brakes.shopfront_clone_outreach (refuse to send
//     while the daily-spend brake is engaged).
//   • Cross-validate the queue recipient against brand_contact_directory
//     so a corrupt row can't mail an arbitrary address.
//   • Pass Resend `idempotencyKey` keyed on batchId — two admins clicking
//     Send concurrently will result in ONE email, not two.
//   • Stamp approved_by_admin_id (Supabase-Auth path only; HMAC path
//     leaves it NULL).
//   • Update shopfront_clone_alerts.submitted_to.brand_notification on
//     success so /admin/clone-watch's brand-breakdown reflects reality.

// Read at call-site via readStringEnv so trailing whitespace in Vercel
// values + DefinePlugin static inlining of `process.env.X` literals both
// fail loud instead of silent.
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

interface TransitionResult {
  updated_count: number;
  observed_status: string | null;
  observed_brand: string | null;
  observed_recipient: string | null;
}

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> },
) {
  await requireAdmin();

  const fromEmail = readStringEnv("RESEND_FROM_EMAIL");
  if (!fromEmail) {
    // Fail closed: missing RESEND_FROM_EMAIL used to silently fall back
    // to a personal-looking sender, which Gmail mis-renders.
    return NextResponse.json(
      { error: "resend_from_email_unset" },
      { status: 503 },
    );
  }

  const { batchId } = await ctx.params;
  // Strict UUID v4-shape — the loose `[0-9a-f-]{36}` form accepted 36 dashes
  // or 36 hex with no group structure, pushing malformed input down to the
  // RPC where it surfaced as a 500 instead of a clean 400.
  if (
    !batchId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      batchId,
    )
  ) {
    return NextResponse.json({ error: "missing_batch_id" }, { status: 400 });
  }

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json(
      { error: "supabase_unavailable" },
      { status: 503 },
    );
  }

  // 0-1. Brand Send Gate preflight (profile "batch"): both flags, readiness
  //      (#1237 — this route mails the REAL contact, it has no shadow mode)
  //      and the shopfront_clone_outreach brake, before the batch is loaded.
  //      The recipient checks run below once the batch is known.
  const gate = createBrandSendGate("batch", sb);
  const pre = await gate.preflight();
  if (!pre.allowed) return refuse(pre.reasons[0]);

  // 2. Load the batch — frozen subject + body live on the queue rows.
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

  // 3. Idempotent terminal-state guards (still here for fast-path before
  //    we hit the RPC; transition_clone_alert_batch also enforces them).
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

  // 4-5. Recipient checks through the same gate: the queue recipient must
  //      match brand_contact_directory on an accepted channel (a mismatch
  //      means the directory changed after prepare, or the row was tampered
  //      with), and must not have unsubscribed or STOP-replied since enqueue.
  //      Lookup is by `brand` — the enqueue path stores directoryRow.brand
  //      into queue.brand (legitimate_domain broke brands like "Domain",
  //      PR #459).
  const decision = await gate.check({ recipient: first.recipient, brand: first.brand });
  if (!decision.allowed) {
    const reason = decision.reasons[0];
    logger.warn("clone-watch send: refused by brand send gate", {
      batchId,
      brand: first.brand,
      code: reason.code,
      recipientHash: hashEmail(first.recipient),
    });
    return refuse(reason);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "resend_not_configured" },
      { status: 503 },
    );
  }

  const adminId = await getAdminUserId();

  // 6. Send via Resend with idempotency key. Two concurrent calls with
  //    the same key result in ONE email (Resend dedups server-side).
  let providerMessageId: string | null = null;
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send(
      {
        from: fromEmail,
        to: [first.recipient],
        replyTo: REPLY_TO_EMAIL,
        subject: first.email_subject,
        html: first.email_body_html,
      },
      {
        idempotencyKey: `clone-watch-send:${batchId}`,
      },
    );
    if (result.error) {
      throw new Error(
        `Resend rejected: ${result.error.message ?? String(result.error)}`,
      );
    }
    providerMessageId = result.data?.id ?? null;
  } catch (err) {
    logger.error("clone-watch send: resend failed", {
      batchId,
      error: String(err),
    });
    // Don't echo the raw Resend error to the client — it can include the
    // recipient email address + message id. Full error is logged above.
    return NextResponse.json(
      { error: "send_failed", details: "resend_error" },
      { status: 502 },
    );
  }

  // 7. Transition the batch. v152 RPC returns structured outcome so we
  //    can distinguish race-loser (someone else already sent) from
  //    actual write.
  const { data: transitionData, error: transErr } = await sb.rpc(
    "transition_clone_alert_batch",
    {
      p_batch_id: batchId,
      p_new_status: "sent",
      p_provider_message_id: providerMessageId,
      p_admin_id: adminId,
    },
  );
  if (transErr) {
    logger.error("clone-watch send: transition failed (email already sent)", {
      batchId,
      providerMessageId,
      error: transErr.message,
    });
    // Email is out. Surface the desync but DO NOT 5xx-loop the admin —
    // they'd retry and Resend's idempotency key would catch the second
    // call, but the queue would still be out of sync.
    return NextResponse.json(
      {
        ok: false,
        emailSent: true,
        providerMessageId,
        error: "transition_failed_after_send",
        details: "db_error",
      },
      { status: 500 },
    );
  }
  const transition = (transitionData as TransitionResult[] | null)?.[0] ?? {
    updated_count: 0,
    observed_status: null,
    observed_brand: null,
    observed_recipient: null,
  };

  // 8. Record send: stamp last_notified_at + submitted_to. Atomic-ish via
  //    a single RPC. Failure here doesn't undo the email (Resend already
  //    fired) but does surface so we know the audit trail is incomplete.
  const { error: recordErr } = await sb.rpc("record_brand_notification_sent", {
    p_batch_id: batchId,
    p_provider_message_id: providerMessageId,
  });
  if (recordErr) {
    logger.warn("clone-watch send: record_brand_notification_sent failed", {
      batchId,
      error: recordErr.message,
    });
    // Don't fail the request — email is out, transition succeeded.
  }

  logCost({
    feature: "shopfront_clone_notify_brand",
    provider: "resend",
    operation: "dashboard_send",
    units: 1,
    unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
    userId: adminId,
    metadata: {
      batch_id: batchId,
      brand: first.brand,
      candidate_count: batch.length,
      provider_message_id: providerMessageId,
      race_loser: transition.updated_count === 0,
    },
  });

  logger.info("clone-watch send: sent", {
    batchId,
    brand: first.brand,
    recipientHash: hashEmail(first.recipient),
    candidates: batch.length,
    providerMessageId,
    adminId,
    raceLoser: transition.updated_count === 0,
  });

  return NextResponse.json({
    ok: true,
    batchId,
    brand: first.brand,
    candidates: batch.length,
    providerMessageId,
    raceLoser: transition.updated_count === 0,
  });
}

function refuse(r: BrandSendRefusal) {
  // `detail` is only set for codes whose text carries no address (hashes only).
  return NextResponse.json({ error: r.code, detail: r.detail }, { status: refusalStatus(r) });
}

/**
 * Stable hash of an email for log lines. We need to be able to correlate
 * across log entries without leaking the address itself. SHA-256 prefix
 * is sufficient — collisions on 12 chars of hex aren't a security concern
 * since the input space (known brand abuse contacts) is small.
 */
function hashEmail(email: string | null | undefined): string {
  if (!email) return "(none)";
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}
