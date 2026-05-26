import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { verifyBatchApproveToken } from "@/lib/clone-watch-approve";

// HMAC-gated reject endpoint — mirror of approve-batch. Admin taps the
// reject URL from Telegram → we verify the HMAC, mark all batch rows as
// 'rejected'. No email is sent. Idempotent.

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
  if (!verifyBatchApproveToken("reject", batchId, brand, recipient, sig)) {
    logger.warn("clone-watch reject: HMAC verify failed", { batchId });
    return htmlResponse(401, "Invalid token");
  }

  const sb = createServiceClient();
  if (!sb) {
    return htmlResponse(503, "Database unavailable");
  }

  const { error } = await sb.rpc("transition_clone_alert_batch", {
    p_batch_id: batchId,
    p_new_status: "rejected",
    p_provider_message_id: null,
  });
  if (error) {
    logger.error("clone-watch reject: transition failed", {
      batchId,
      error: error.message,
    });
    return htmlResponse(500, `Database error: ${error.message}`);
  }

  logger.info("clone-watch reject: marked", { batchId, brand, recipient });

  return htmlResponse(
    200,
    `<h1>Rejected</h1>
     <p>Batch <code>${batchId}</code> for <code>${brand}</code> marked rejected. No email was sent.</p>`,
  );
}

function htmlResponse(status: number, bodyHtml: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><title>Clone-watch reject</title></head><body style="font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#0F172A">${bodyHtml}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
