import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

// POST /api/admin/clone-watch/batches/[batchId]/reject
//
// Dashboard-driven rejection: admin clicks "Reject" on a pending batch in
// /admin/clone-watch#approvals → we transition the batch to 'rejected'.
// No email sent.
//
// Hardening pass v152 (2026-05-27):
//   • Surfaces 409 when the batch is already terminal (previously
//     returned 200 silently, misleading the UI into showing "rejected"
//     for batches that had actually been sent).
//   • Captures rejected_by_admin_id when available.

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

  const { batchId } = await ctx.params;
  // Strict UUID v4-shape (the loose `[0-9a-f-]{36}` accepted 36 dashes).
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

  const adminId = await getAdminUserId();

  const { data, error } = await sb.rpc("transition_clone_alert_batch", {
    p_batch_id: batchId,
    p_new_status: "rejected",
    p_provider_message_id: null,
    p_admin_id: adminId,
  });
  if (error) {
    logger.error("clone-watch reject: transition failed", {
      batchId,
      error: error.message,
    });
    return NextResponse.json(
      { error: "transition_failed", details: "db_error" },
      { status: 500 },
    );
  }

  const transition = (data as TransitionResult[] | null)?.[0] ?? {
    updated_count: 0,
    observed_status: null,
    observed_brand: null,
    observed_recipient: null,
  };

  if (transition.observed_status === null) {
    return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  }

  if (transition.updated_count === 0) {
    // Batch is in a terminal state — surface what we saw so the UI can
    // refresh and stop pretending the row was rejected. Previously this
    // returned 200 silently.
    if (transition.observed_status === "sent") {
      return NextResponse.json(
        { error: "already_sent", observedStatus: "sent" },
        { status: 409 },
      );
    }
    if (transition.observed_status === "rejected") {
      // Genuinely already-rejected — idempotent success.
      return NextResponse.json({
        ok: true,
        alreadyRejected: true,
        batchId,
      });
    }
    return NextResponse.json(
      {
        error: "invalid_state",
        observedStatus: transition.observed_status,
      },
      { status: 409 },
    );
  }

  logger.info("clone-watch reject: marked", {
    batchId,
    brand: transition.observed_brand,
    adminId,
  });

  return NextResponse.json({
    ok: true,
    batchId,
    brand: transition.observed_brand,
  });
}
