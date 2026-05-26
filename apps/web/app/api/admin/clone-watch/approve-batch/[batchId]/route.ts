import { NextResponse, type NextRequest } from "next/server";
import { Resend } from "resend";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { verifyBatchApproveToken } from "@/lib/clone-watch-approve";
import { logCost, PRICING } from "@/lib/cost-telemetry";

// HMAC-gated approval endpoint for clone-watch brand-notification batches.
// One-click flow: admin taps the URL from Telegram → we verify the HMAC,
// load the batch (frozen subject + body), send via Resend, mark sent.
//
// Idempotent: re-approving a 'sent' batch is a no-op.

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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ batchId: string }> },
) {
  const { batchId } = await ctx.params;
  const brand = req.nextUrl.searchParams.get("brand") ?? "";
  const recipient = req.nextUrl.searchParams.get("recipient") ?? "";
  const sig = req.nextUrl.searchParams.get("sig") ?? "";

  if (!batchId || !brand || !recipient || !sig) {
    return htmlResponse(400, "Missing required parameters");
  }
  if (!verifyBatchApproveToken("approve", batchId, brand, recipient, sig)) {
    logger.warn("clone-watch approve: HMAC verify failed", {
      batchId,
      brand,
      recipient,
    });
    return htmlResponse(401, "Invalid approval token");
  }

  const sb = createServiceClient();
  if (!sb) {
    return htmlResponse(503, "Database unavailable");
  }

  const { data: rows, error } = await sb.rpc("load_clone_alert_batch", {
    p_batch_id: batchId,
  });
  if (error) {
    logger.error("clone-watch approve: load failed", {
      batchId,
      error: error.message,
    });
    return htmlResponse(500, `Database error: ${error.message}`);
  }
  const batch = (rows as BatchRow[] | null) ?? [];
  if (batch.length === 0) {
    return htmlResponse(404, "Batch not found");
  }

  // Ownership check — the HMAC already validates (action,batchId,brand,recipient)
  // but cross-check against the persisted row in case the directory changed.
  const first = batch[0];
  if (first.brand !== brand || first.recipient !== recipient) {
    logger.warn("clone-watch approve: batch/url brand or recipient mismatch", {
      batchId,
      urlBrand: brand,
      rowBrand: first.brand,
      urlRecipient: recipient,
      rowRecipient: first.recipient,
    });
    return htmlResponse(400, "Batch does not match URL parameters");
  }

  // Idempotent — already sent / rejected → no-op
  if (first.approval_status === "sent") {
    return htmlResponse(
      200,
      `<h1>Already sent</h1><p>Batch ${batchId} was already approved + sent.</p>`,
    );
  }
  if (first.approval_status === "rejected") {
    return htmlResponse(
      409,
      `<h1>Already rejected</h1><p>Batch ${batchId} was previously rejected and cannot be re-approved.</p>`,
    );
  }
  if (first.approval_status === "expired") {
    return htmlResponse(
      410,
      `<h1>Expired</h1><p>Batch ${batchId} expired before approval. A new batch will be prepared at the next 09:30 UTC cron run.</p>`,
    );
  }
  if (
    first.approval_status !== "pending" &&
    first.approval_status !== "approved"
  ) {
    return htmlResponse(
      400,
      `<h1>Invalid state</h1><p>Batch in unexpected state: ${first.approval_status}</p>`,
    );
  }
  if (!first.email_subject || !first.email_body_html) {
    return htmlResponse(
      500,
      "Batch missing frozen email subject or body (prepare cron did not populate them)",
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return htmlResponse(503, "RESEND_API_KEY not configured");
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [recipient],
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

    await sb.rpc("transition_clone_alert_batch", {
      p_batch_id: batchId,
      p_new_status: "sent",
      p_provider_message_id: providerMessageId,
    });

    logCost({
      feature: "shopfront_clone_notify_brand",
      provider: "resend",
      operation: "approved_send",
      units: 1,
      unitCostUsd: PRICING.RESEND_USD_PER_EMAIL,
      metadata: {
        batch_id: batchId,
        brand,
        recipient,
        candidate_count: batch.length,
        provider_message_id: providerMessageId,
      },
    });

    logger.info("clone-watch approve: sent", {
      batchId,
      brand,
      recipient,
      candidates: batch.length,
      providerMessageId,
    });

    return htmlResponse(
      200,
      `<h1>Sent ✅</h1>
       <p>Batch <code>${batchId}</code> sent to <code>${recipient}</code> with <strong>${batch.length}</strong> candidate(s).</p>
       <p>Resend message id: <code>${providerMessageId ?? "(none)"}</code></p>`,
    );
  } catch (err) {
    logger.error("clone-watch approve: send failed", {
      batchId,
      error: String(err),
    });
    return htmlResponse(500, `Send failed: ${String(err)}`);
  }
}

function htmlResponse(status: number, bodyHtml: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Clone-watch approval</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#0F172A">${bodyHtml}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
