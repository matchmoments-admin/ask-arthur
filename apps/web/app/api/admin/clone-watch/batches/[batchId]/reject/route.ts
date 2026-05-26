import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

// POST /api/admin/clone-watch/batches/[batchId]/reject
//
// Dashboard-driven rejection: admin clicks "Reject" on a pending batch in
// /admin/clone-watch#approvals → we transition the batch to 'rejected'.
// No email sent.
//
// Replaces the HMAC-URL reject-batch route.

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
    return NextResponse.json(
      { error: "transition_failed", details: error.message },
      { status: 500 },
    );
  }

  logger.info("clone-watch reject: marked", { batchId });

  return NextResponse.json({ ok: true, batchId });
}
