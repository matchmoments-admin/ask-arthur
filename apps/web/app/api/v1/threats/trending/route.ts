import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  // API key authentication
  const auth = await validateApiKey(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      {
        status: 429,
        headers: { "Retry-After": "3600" },
      }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  // Parse query parameters
  const { searchParams } = req.nextUrl;
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "7"), 1), 90);
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10"), 1), 50);
  const region = searchParams.get("region");

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Query verified scams
  let query = supabase
    .from("verified_scams")
    .select("scam_type, summary, impersonated_brand, channel, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false });

  if (region) {
    query = query.eq("region", region);
  }

  const { data: scams, error } = await query;

  if (error) {
    logger.error("Threat API query error", { error: String(error) });
    return NextResponse.json(
      { error: "Failed to fetch threat data" },
      { status: 500 }
    );
  }

  // Aggregate by scam_type
  const grouped = new Map<
    string,
    {
      scam_type: string;
      count: number;
      brands: Set<string>;
      channels: Set<string>;
      latest_seen: string;
      summaries: string[];
    }
  >();

  for (const scam of scams || []) {
    const key = scam.scam_type || "other";
    const existing = grouped.get(key);

    if (existing) {
      existing.count++;
      if (scam.impersonated_brand) existing.brands.add(scam.impersonated_brand);
      if (scam.channel) existing.channels.add(scam.channel);
      if (scam.created_at > existing.latest_seen) {
        existing.latest_seen = scam.created_at;
      }
      if (existing.summaries.length < 3) {
        existing.summaries.push(scam.summary);
      }
    } else {
      grouped.set(key, {
        scam_type: key,
        count: 1,
        brands: new Set(scam.impersonated_brand ? [scam.impersonated_brand] : []),
        channels: new Set(scam.channel ? [scam.channel] : []),
        latest_seen: scam.created_at,
        summaries: [scam.summary],
      });
    }
  }

  // Sort by count descending, limit results
  const threats = Array.from(grouped.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((t) => ({
      scam_type: t.scam_type,
      incident_count: t.count,
      impersonated_brands: Array.from(t.brands),
      channels: Array.from(t.channels),
      latest_seen: t.latest_seen,
      example_summaries: t.summaries,
    }));

  const response = {
    meta: {
      period_days: days,
      total_threats: scams?.length || 0,
      generated_at: new Date().toISOString(),
      ...(region && { region }),
    },
    threats,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
