import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiAuth";
import { createServiceClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  // API key authentication
  const auth = await validateApiKey(req);
  if (!auth.valid) {
    return NextResponse.json(
      { error: "Invalid or missing API key" },
      { status: 401 }
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }

  // Get aggregate stats
  const now = new Date();
  const periods = {
    last_24h: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    last_7d: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    last_30d: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
  };

  const [day, week, month] = await Promise.all([
    supabase
      .from("verified_scams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", periods.last_24h.toISOString()),
    supabase
      .from("verified_scams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", periods.last_7d.toISOString()),
    supabase
      .from("verified_scams")
      .select("id", { count: "exact", head: true })
      .gte("created_at", periods.last_30d.toISOString()),
  ]);

  // Top scam types this week
  const { data: weeklyScams } = await supabase
    .from("verified_scams")
    .select("scam_type")
    .gte("created_at", periods.last_7d.toISOString());

  const typeCounts = new Map<string, number>();
  for (const s of weeklyScams || []) {
    typeCounts.set(s.scam_type, (typeCounts.get(s.scam_type) || 0) + 1);
  }

  const topTypes = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([type, count]) => ({ scam_type: type, count }));

  const response = {
    generated_at: now.toISOString(),
    verified_threats: {
      last_24h: day.count || 0,
      last_7d: week.count || 0,
      last_30d: month.count || 0,
    },
    top_scam_types_7d: topTypes,
  };

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
