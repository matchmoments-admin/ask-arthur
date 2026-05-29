import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ensure next-month partitions exist on the three partitioned hot tables.
// Idempotent — safe to re-run. Scheduled daily; the critical moment is the
// transition between UTC months when fresh inserts start landing in a new
// range.
export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  try {
    const { error } = await supabase.rpc("ensure_next_month_partitions");
    if (error) throw new Error(error.message);
    logger.info("ensure-partitions complete");
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("ensure-partitions failed", { error: String(err) });
    return NextResponse.json({ error: "failed", message: String(err) }, { status: 500 });
  }
}
