import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nightly onward_report_log retention sweep.
 *
 * v119 sets `retention_expires_at` (24mo) at insert, but nothing deleted
 * expired rows — this closes that gap. Chunked (≤5K ids/iteration) so a large
 * backlog can never run as one unbounded DELETE on the ledger.
 *
 * Schedule (vercel.json): 35 3 * * * (3:35am UTC — after clone-watch-retention
 * at 3:15). Auth: Bearer CRON_SECRET like the other /api/cron/* routes.
 *
 * No-op today (onward_report_log is empty until the onward flags are flipped).
 */
const CHUNK = 5000;
const MAX_ITERATIONS = 50; // 250K-row safety ceiling

export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const nowIso = new Date().toISOString();
  let purged = 0;
  let iterations = 0;

  for (; iterations < MAX_ITERATIONS; iterations++) {
    const { data: ids, error: selErr } = await supabase
      .from("onward_report_log")
      .select("id")
      .lt("retention_expires_at", nowIso)
      .limit(CHUNK);
    if (selErr) {
      logger.error("onward-retention: select failed", { error: selErr.message });
      return NextResponse.json({ error: "select_failed" }, { status: 500 });
    }
    const batch = (ids ?? []).map((r) => r.id as string);
    if (batch.length === 0) break;

    const { error: delErr } = await supabase
      .from("onward_report_log")
      .delete()
      .in("id", batch);
    if (delErr) {
      logger.error("onward-retention: delete failed", { error: delErr.message });
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }
    purged += batch.length;
    if (batch.length < CHUNK) break;
  }

  if (iterations >= MAX_ITERATIONS) {
    logger.warn("onward-retention: hit iteration ceiling; more rows remain", {
      purged,
    });
  }
  logger.info("onward-retention: complete", { purged, iterations });
  return NextResponse.json({ ok: true, purged });
}
