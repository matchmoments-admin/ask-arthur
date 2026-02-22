import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export async function GET(req: NextRequest) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ message: "Database not configured" });
    }

    // Run queries in parallel
    const [activeUrls, pendingEnrichment, recentIngestions] = await Promise.all([
      // Active URL count
      supabase
        .from("scam_urls")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),

      // Pending enrichment count
      supabase
        .from("scam_urls")
        .select("id", { count: "exact", head: true })
        .eq("enrichment_status", "pending")
        .eq("is_active", true),

      // Recent ingestion log entries (last 10 per feed)
      supabase
        .from("feed_ingestion_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    // Group ingestion logs by feed and get last successful run per feed
    const ingestionsByFeed: Record<string, unknown[]> = {};
    const lastSuccessPerFeed: Record<string, string> = {};

    for (const log of recentIngestions.data || []) {
      const feed = log.feed_name;
      if (!ingestionsByFeed[feed]) {
        ingestionsByFeed[feed] = [];
      }
      ingestionsByFeed[feed].push(log);

      if (log.status === "success" && !lastSuccessPerFeed[feed]) {
        lastSuccessPerFeed[feed] = log.created_at;
      }
    }

    return NextResponse.json({
      activeUrlCount: activeUrls.count ?? 0,
      pendingEnrichmentCount: pendingEnrichment.count ?? 0,
      lastSuccessPerFeed,
      recentIngestions: ingestionsByFeed,
    });
  } catch (err) {
    logger.error("Pipeline health check error", { error: String(err) });
    return NextResponse.json(
      { error: "Health check failed" },
      { status: 500 }
    );
  }
}
