import { NextRequest, NextResponse } from "next/server";
import { validateApiKey, logApiUsage } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

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

  // Log usage
  if (auth.keyHash) {
    logApiUsage(auth.keyHash, "deepfakes.trending");
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
