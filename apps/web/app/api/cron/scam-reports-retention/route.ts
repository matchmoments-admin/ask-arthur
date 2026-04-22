import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily retention pass. Calls archive_scam_reports_batch() repeatedly until it
// reports zero rows moved, bounded by a wall-clock budget so we never hold a
// transaction for the full Vercel timeout.
//
// No data is deleted — rows move from scam_reports to scam_reports_archive
// (and links to report_entity_links_archive). Queries that need full history
// read from the scam_reports_all view.
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
  const deadlineMs = 45_000;
  let totalReports = 0;
  let totalLinks = 0;
  let totalClusterLinks = 0;
  let batches = 0;

  try {
    while (Date.now() - startedAt < deadlineMs) {
      const { data, error } = await supabase.rpc("archive_scam_reports_batch", {
        p_batch_size: 5000,
        p_high_risk_days: 180,
        p_default_days: 90,
      });
      if (error) throw new Error(error.message);

      const row = Array.isArray(data) ? data[0] : data;
      const movedReports = Number(row?.moved_reports ?? 0);
      const movedLinks = Number(row?.moved_links ?? 0);
      const movedCluster = Number(row?.moved_cluster_links ?? 0);

      totalReports += movedReports;
      totalLinks += movedLinks;
      totalClusterLinks += movedCluster;
      batches++;

      if (movedReports === 0) break;
    }

    logger.info("scam-reports-retention complete", {
      batches,
      totalReports,
      totalLinks,
      totalClusterLinks,
      elapsedMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      ok: true,
      batches,
      movedReports: totalReports,
      movedLinks: totalLinks,
      movedClusterLinks: totalClusterLinks,
    });
  } catch (err) {
    logger.error("scam-reports-retention failed", {
      error: String(err),
      batches,
      totalReports,
    });
    return NextResponse.json(
      {
        error: "retention_failed",
        message: String(err),
        partial: { batches, totalReports, totalLinks },
      },
      { status: 500 },
    );
  }
}
