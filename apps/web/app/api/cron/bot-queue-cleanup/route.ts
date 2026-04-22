import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard-delete terminal bot_message_queue rows older than 24h.
// markCompleted/markFailed already null out message_text/images/reply_to when a
// row reaches a terminal state; this cron is the defence-in-depth purge so
// terminal rows don't linger in the table indefinitely.
//
// Pending/processing rows are intentionally left alone — the sweeper handles
// those via retry + fail-after-max-retries. The 48h pending safety net catches
// anything stuck with an unrecoverable error.
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const terminalCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const staleBlackHoleCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  try {
    const { count: terminalDeleted, error: termErr } = await supabase
      .from("bot_message_queue")
      .delete({ count: "exact" })
      .in("status", ["completed", "failed"])
      .lt("created_at", terminalCutoff);

    if (termErr) throw new Error(`terminal purge: ${termErr.message}`);

    // Any pending/processing row older than 48h is either orphaned or stuck in
    // a loop we can't recover from — purge to stop PII from sitting forever.
    const { count: stuckDeleted, error: stuckErr } = await supabase
      .from("bot_message_queue")
      .delete({ count: "exact" })
      .in("status", ["pending", "processing"])
      .lt("created_at", staleBlackHoleCutoff);

    if (stuckErr) throw new Error(`stuck purge: ${stuckErr.message}`);

    logger.info("bot-queue-cleanup complete", {
      terminalDeleted: terminalDeleted ?? 0,
      stuckDeleted: stuckDeleted ?? 0,
    });

    return NextResponse.json({
      ok: true,
      terminalDeleted: terminalDeleted ?? 0,
      stuckDeleted: stuckDeleted ?? 0,
    });
  } catch (err) {
    logger.error("bot-queue-cleanup failed", { error: String(err) });
    return NextResponse.json(
      { error: "cleanup_failed", message: String(err) },
      { status: 500 },
    );
  }
}
