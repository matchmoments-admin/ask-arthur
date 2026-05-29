import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily retention pass for shop_checks (Shop Signal Stage 1). Calls
// cleanup_expired_shop_checks() repeatedly until it reports zero rows
// deleted, bounded by a 45s wall-clock budget so we never hold a
// transaction for the full Vercel timeout. Each RPC call deletes one
// batch of <=5000 TTL-expired rows (ttl_expires_at < now(); 90-day TTL).
//
// Expected duration: seconds on a healthy DB — well under the 10-minute
// pg-stuck-query-watchdog threshold.
export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const startedAt = Date.now();
  const deadlineMs = 45_000;
  let totalDeleted = 0;
  let batches = 0;

  try {
    while (Date.now() - startedAt < deadlineMs) {
      const { data, error } = await supabase.rpc("cleanup_expired_shop_checks", {
        p_batch_size: 5000,
      });
      if (error) throw new Error(error.message);

      const deleted = Number(Array.isArray(data) ? data[0] : data) || 0;
      totalDeleted += deleted;
      batches++;

      if (deleted === 0) break;
    }

    logger.info("shop-checks-retention complete", {
      batches,
      totalDeleted,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, batches, deleted: totalDeleted });
  } catch (err) {
    logger.error("shop-checks-retention failed", {
      error: String(err),
      batches,
      totalDeleted,
    });
    return NextResponse.json(
      {
        error: "retention_failed",
        message: String(err),
        partial: { batches, totalDeleted },
      },
      { status: 500 },
    );
  }
}
