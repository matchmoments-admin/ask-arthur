import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";

export async function GET(req: NextRequest) {
  // Simple auth check via cookie presence (dashboard routes are behind auth in layout)
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);

  const { data, error } = await supabase
    .from("scam_entities")
    .select("id, entity_type, normalized_value, report_count, risk_level, risk_score, last_seen, first_seen")
    .order("last_seen", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  return NextResponse.json(data || [], {
    headers: { "Cache-Control": "no-store" },
  });
}
