import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

/**
 * Serve the top 10K most dangerous domains for offline mobile detection.
 * Cached aggressively — this data changes slowly.
 */
export async function GET() {
  if (!featureFlags.offlineDB) {
    return NextResponse.json(
      { error: "Offline DB not enabled" },
      { status: 404 }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  try {
    const { data, error } = await supabase
      .from("scam_urls")
      .select("domain, scam_type")
      .gte("report_count", 2)
      .order("report_count", { ascending: false })
      .limit(10000);

    if (error) {
      logger.error("Failed to fetch threat snapshot", { error });
      return NextResponse.json(
        { error: "Failed to fetch data" },
        { status: 500 }
      );
    }

    // Map to compact format for mobile
    const snapshot = (data ?? []).map((row) => ({
      domain: row.domain,
      threat_level: "HIGH",
      scam_type: row.scam_type ?? null,
    }));

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (err) {
    logger.error("Threat snapshot error", { error: err });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
