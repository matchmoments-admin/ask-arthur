import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { inngest } from "@askarthur/scam-engine/inngest/client";

const Body = z.object({
  log_id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reject_reason: z.string().max(500).optional(),
});

/**
 * Admin action on a manual_review onward_report_log row.
 *
 *  approve → set status='queued' + re-fire the destination's Inngest
 *           event with bypassManualReview=true. The brand-abuse worker
 *           skips its threshold gate and sends.
 *
 *  reject  → set status='skipped' with reason='admin_rejected: <reason>'.
 *           No event re-fire; the audit trail records the human decision.
 */
export async function POST(req: NextRequest) {
  await requireAdmin();

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { log_id, action, reject_reason } = parsed.data;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  // Load the row first so we know what destination event to re-fire.
  const { data: row, error: loadErr } = await supabase
    .from("onward_report_log")
    .select(
      "id, scam_report_id, analysis_id, destination, destination_key, status"
    )
    .eq("id", log_id)
    .maybeSingle();

  if (loadErr || !row) {
    return NextResponse.json({ error: "Log row not found" }, { status: 404 });
  }
  if (row.status !== "manual_review") {
    return NextResponse.json(
      {
        error: `Row is not awaiting review (status=${row.status}). No action taken.`,
      },
      { status: 409 }
    );
  }

  if (action === "reject") {
    const { error: updateErr } = await supabase
      .from("onward_report_log")
      .update({
        status: "skipped",
        status_reason: `admin_rejected${reject_reason ? `: ${reject_reason.slice(0, 200)}` : ""}`,
        sent_at: new Date().toISOString(),
      })
      .eq("id", log_id);
    if (updateErr) {
      logger.error("admin reject onward update failed", {
        error: String(updateErr),
      });
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // approve: queue + re-fire Inngest event with bypass flag
  const { error: queueErr } = await supabase
    .from("onward_report_log")
    .update({
      status: "queued",
      status_reason: "admin_approved_bypass_gate",
    })
    .eq("id", log_id);
  if (queueErr) {
    logger.error("admin approve onward update failed", {
      error: String(queueErr),
    });
    return NextResponse.json({ error: queueErr.message }, { status: 500 });
  }

  try {
    await inngest.send({
      name: `report.onward.${row.destination}` as const,
      data: {
        log_id: row.id,
        scam_report_id: row.scam_report_id,
        destination_key: row.destination_key,
        analysis_id: row.analysis_id,
        bypassManualReview: true,
      },
    });
  } catch (err) {
    logger.error("inngest.send for admin-approved onward failed", {
      error: String(err),
    });
    // Row stays as 'queued' — admin can hit Approve again later.
    return NextResponse.json(
      { error: "Inngest send failed; row marked queued, please retry" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, action: "approved" });
}
