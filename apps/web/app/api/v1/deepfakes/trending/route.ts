import { NextRequest, NextResponse } from "next/server";
import { guardV1 } from "@/lib/v1-guard";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export async function GET(req: NextRequest) {
  const guard = await guardV1(req);
  if (!guard.ok) return guard.error;

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  try {
    // Top 10 impersonated celebrities by detection_count in last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data: celebrities, error } = await supabase
      .from("monitored_celebrities")
      .select("id, name, detection_count, last_detected_at")
      .gt("detection_count", 0)
      .gte("last_detected_at", since.toISOString())
      .order("detection_count", { ascending: false })
      .limit(10);

    if (error) {
      logger.error("Deepfakes trending query error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch trending data" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        meta: {
          period_days: 30,
          generated_at: new Date().toISOString(),
        },
        trending: celebrities ?? [],
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    logger.error("Deepfakes trending API error", { error: String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
