import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nightly clone-watch retention sweep.
 *
 * Three chunked passes (all idempotent, ≤5K rows/iteration via the RPCs):
 *
 *   1. Expire stale pending batches  (>7 days unconfirmed → 'expired')
 *   2. Purge old terminal queue rows (>90d sent/rejected/expired/skipped)
 *   3. Purge old FP clone alerts     (>90d, ON DELETE CASCADE cleans queue)
 *
 * TP-confirmed / tp_actioned alerts are kept indefinitely — they power
 * the 30-365d brand-breakdown + takedown-stats RPCs.
 *
 * Schedule (vercel.json): 15 3 * * * (3:15am UTC daily — between
 * vuln-retention at 03:00 and scam-reports-retention at 03:30).
 * Auth: Bearer CRON_SECRET matching the other /api/cron/* routes.
 *
 * Born from the 2026-05-27 review: v151's schema comment promised an
 * "auto-expired by cleanup cron" path that was never built.
 */
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

  const startedAt = Date.now();
  const summary = {
    expired_pending: 0,
    purged_queue_rows: 0,
    purged_fp_alerts: 0,
    iterations: { expire: 0, purge_queue: 0, purge_fp: 0 },
    duration_ms: 0,
  };

  // Bound the whole run so we don't blow the watchdog 10-min budget.
  // 4 minutes is plenty for the volumes we expect (low hundreds/day).
  const deadline = startedAt + 4 * 60 * 1000;

  // 1. Expire stale pending batches.
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc(
      "expire_stale_pending_clone_batches",
      { p_older_than_hours: 168, p_chunk_size: 1000 },
    );
    if (error) {
      logger.error("clone-watch-retention: expire failed", {
        error: error.message,
      });
      break;
    }
    const n = (data as number | null) ?? 0;
    summary.expired_pending += n;
    summary.iterations.expire++;
    if (n < 1000) break; // chunk wasn't full → no more eligible rows
  }

  // 2. Purge old terminal queue rows.
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc(
      "purge_old_clone_alert_queue_rows",
      { p_older_than_days: 90, p_chunk_size: 1000 },
    );
    if (error) {
      logger.error("clone-watch-retention: queue purge failed", {
        error: error.message,
      });
      break;
    }
    const n = (data as number | null) ?? 0;
    summary.purged_queue_rows += n;
    summary.iterations.purge_queue++;
    if (n < 1000) break;
  }

  // 3. Purge old FP clone alerts (cascades to queue rows referencing them).
  while (Date.now() < deadline) {
    const { data, error } = await supabase.rpc("purge_old_fp_clone_alerts", {
      p_older_than_days: 90,
      p_chunk_size: 1000,
    });
    if (error) {
      logger.error("clone-watch-retention: fp purge failed", {
        error: error.message,
      });
      break;
    }
    const n = (data as number | null) ?? 0;
    summary.purged_fp_alerts += n;
    summary.iterations.purge_fp++;
    if (n < 1000) break;
  }

  summary.duration_ms = Date.now() - startedAt;
  logger.info("clone-watch-retention: done", summary);

  return NextResponse.json({ ok: true, ...summary });
}
