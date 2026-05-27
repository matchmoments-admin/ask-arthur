import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost, PRICING } from "@/lib/cost-telemetry";

// POST /api/admin/clone-watch/batches/[batchId]/send
//
// Dashboard-driven approval: the admin clicks "Send" on a pending batch
// in /admin/clone-watch#approvals → we load the frozen email subject + body
// from the queue, send via Resend with an idempotency key, transition the
// batch to 'sent', and stamp brand_contact_directory.last_notified_at +
// shopfront_clone_alerts.submitted_to.brand_notification.status='sent'.
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

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL;
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

  if (!featureFlags.shopfrontCloneOutreach) {
    return NextResponse.json(
      { error: "clone_outreach_disabled" },
      { status: 503 },
    );
  }
  if (!featureFlags.shopfrontCloneNotifyBrand) {
    return NextResponse.json(
      { error: "clone_notify_brand_disabled" },
      { status: 503 },
    );
  }

  if (!FROM_EMAIL) {
    // Fail closed: missing RESEND_FROM_EMAIL used to silently fall back
    // to a personal-looking sender, which Gmail mis-renders.
    return NextResponse.json(
      { error: "resend_from_email_unset" },
      { status: 503 },
    );
  }

  const { batchId } = await ctx.params;
  if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId)) {
    return NextResponse.json({ error: "missing_batch_id" }, { status: 400 });
  }

  const sb = createServiceClient();
  if (!sb) {
    return NextResponse.json(
      { error: "supabase_unavailable" },
      { status: 503 },
    );
  }

  // 1. Cost brake — if shopfront_clone_outreach is paused, refuse pre-send.
  const brakeEngaged = await isShopfrontCloneBrakeEngaged(sb);
  if (brakeEngaged) {
    return NextResponse.json(
      { error: "cost_brake_engaged" },
      { status: 503 },
    );
  }

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

  // 4. Cross-validate recipient against brand_contact_directory. A
  //    mismatch means either (a) directory was edited after the batch
  //    was prepared, or (b) the queue row has been tampered with. Refuse.
  const { data: directoryRows, error: directoryErr } = await sb
    .from("brand_contact_directory")
    .select("recipient, channel_type")
    .eq("legitimate_domain", first.brand)
    .limit(1);
  if (directoryErr) {
    logger.error("clone-watch send: directory lookup failed", {
      batchId,
      brand: first.brand,
      error: directoryErr.message,
    });
    return NextResponse.json({ error: "directory_lookup_failed" }, { status: 500 });
  }
  const directoryRow = directoryRows?.[0];
  if (!directoryRow) {
    return NextResponse.json(
      { error: "directory_row_missing" },
      { status: 409 },
    );
  }
  if (
    directoryRow.recipient !== first.recipient ||
    (directoryRow.channel_type !== "security_txt" &&
      directoryRow.channel_type !== "fraud_inbox")
  ) {
    logger.warn("clone-watch send: recipient mismatch", {
      batchId,
      brand: first.brand,
      queueRecipientHash: hashEmail(first.recipient),
      directoryRecipientHash: hashEmail(directoryRow.recipient),
    });
    return NextResponse.json(
      { error: "recipient_mismatch" },
      { status: 409 },
    );
  }

  // 5. Re-check suppression. Between enqueue and admin click the brand
  //    may have STOP-replied.
  const { data: suppressed } = await sb.rpc(
    "clone_alert_recipient_is_suppressed",
    { p_email: first.recipient },
  );
  if (suppressed === true) {
    return NextResponse.json(
      { error: "recipient_suppressed" },
      { status: 409 },
    );
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
        from: FROM_EMAIL,
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
    return NextResponse.json(
      { error: "send_failed", details: String(err) },
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
        details: transErr.message,
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

async function isShopfrontCloneBrakeEngaged(
  sb: ReturnType<typeof createServiceClient>,
): Promise<boolean> {
  if (!sb) return true;
  const { data, error } = await sb
    .from("feature_brakes")
    .select("paused_until")
    .eq("feature", "shopfront_clone_outreach")
    .maybeSingle();
  if (error) {
    logger.warn("clone-watch send: feature_brakes lookup failed", {
      error: error.message,
    });
    // Conservative: treat lookup failure as brake engaged. Mirrors the
    // apivoid pattern.
    return true;
  }
  return Boolean(
    data?.paused_until && new Date(data.paused_until).getTime() > Date.now(),
  );
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
