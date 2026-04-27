import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { jsonV1 } from "@/app/api/v1/_lib/json-response";

export async function GET(req: NextRequest) {
  const auth = await validateApiKey(req, "/v1/usage");
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }
  if (auth.rateLimited) {
    return NextResponse.json(
      { error: "Daily API limit exceeded. Resets at midnight UTC." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const days = Math.min(
    parseInt(req.nextUrl.searchParams.get("days") || "30", 10),
    90
  );
  const since = new Date();
  since.setDate(since.getDate() - days);

  try {
    const { data, error } = await supabase
      .from("api_usage_log")
      .select("endpoint, day, call_count, last_called")
      .eq("key_hash", auth.keyHash!)
      .gte("day", since.toISOString().slice(0, 10))
      .order("day", { ascending: false });

    if (error) {
      logger.error("Usage stats query error", { error: String(error) });
      return NextResponse.json(
        { error: "Failed to fetch usage stats" },
        { status: 500 }
      );
    }

    // Aggregate by endpoint
    const byEndpoint: Record<
      string,
      { totalCalls: number; lastCalled: string }
    > = {};
    let totalCalls = 0;

    for (const row of data || []) {
      const ep = row.endpoint;
      if (!byEndpoint[ep]) {
        byEndpoint[ep] = { totalCalls: 0, lastCalled: row.last_called };
      }
      byEndpoint[ep].totalCalls += row.call_count;
      totalCalls += row.call_count;
      if (row.last_called > byEndpoint[ep].lastCalled) {
        byEndpoint[ep].lastCalled = row.last_called;
      }
    }

    // Daily totals
    const byDay: Record<string, number> = {};
    for (const row of data || []) {
      byDay[row.day] = (byDay[row.day] || 0) + row.call_count;
    }

    return jsonV1({
      period: { days, since: since.toISOString().slice(0, 10) },
      totalCalls,
      dailyRemaining: auth.dailyRemaining,
      byEndpoint,
      dailyBreakdown: Object.entries(byDay)
        .map(([day, count]) => ({ day, calls: count }))
        .sort((a, b) => b.day.localeCompare(a.day)),
    });
  } catch (err) {
    logger.error("Usage stats error", { error: String(err) });
    return NextResponse.json(
      { error: "Failed to fetch usage stats" },
      { status: 500 }
    );
  }
}
