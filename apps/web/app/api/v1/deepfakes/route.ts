import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, logApiUsage } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

function parsePeriodDays(period: string | null): number {
  if (!period) return 30;
  const match = period.match(/^(\d+)d$/);
  if (!match) return 30;
  const days = parseInt(match[1]!);
  return Math.min(Math.max(days, 1), 90);
}

export async function GET(req: NextRequest) {
  // API key authentication
  const auth = await validateApiKey(req, "deepfakes");
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  if (auth.endpointBlocked) {
    return NextResponse.json(
      { error: "Your API key does not have access to this endpoint" },
      { status: 403 }
    );
  }

  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  if (auth.minuteRateLimited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  const { searchParams } = req.nextUrl;
  const celebrity = searchParams.get("celebrity");
  const period = searchParams.get("period");

  const days = parsePeriodDays(period);
  const since = new Date();
  since.setDate(since.getDate() - days);

  // Log usage
  if (auth.keyHash) {
    logApiUsage(auth.keyHash, "deepfakes");
  }

  try {
    if (celebrity) {
      // Return recent detections for a specific celebrity
      const { data: detections, error } = await supabase
        .from("deepfake_detections")
        .select(
          "id, celebrity_name, ai_confidence, deepfake_confidence, generator_source, ad_text_excerpt, landing_url, advertiser_name, reported_to_meta, created_at"
        )
        .ilike("celebrity_name", `%${celebrity}%`)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        logger.error("Deepfakes API query error", { error: String(error) });
        return NextResponse.json(
          { error: "Failed to fetch deepfake data" },
          { status: 500 }
        );
      }

      return NextResponse.json(
        {
          meta: {
            celebrity,
            period_days: days,
            total: detections?.length ?? 0,
            generated_at: new Date().toISOString(),
          },
          detections: detections ?? [],
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
          },
        }
      );
    }

    // Default: trending — top 10 impersonated celebrities by detection_count
    const { data: celebrities, error } = await supabase
      .from("monitored_celebrities")
      .select("id, name, detection_count, last_detected_at")
      .gt("detection_count", 0)
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
          period_days: days,
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
    logger.error("Deepfakes API error", { error: String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
