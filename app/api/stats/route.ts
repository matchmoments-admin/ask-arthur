import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function GET() {
  try {
    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ totalChecks: 0 }, { status: 200 });
    }

    const { data, error } = await supabase
      .from("check_stats")
      .select("total_checks, safe_count, suspicious_count, high_risk_count");

    if (error) {
      console.error("Stats query error:", error);
      return NextResponse.json({ totalChecks: 0 }, { status: 200 });
    }

    const totals = (data || []).reduce(
      (acc, row) => ({
        totalChecks: acc.totalChecks + (row.total_checks || 0),
        safeCount: acc.safeCount + (row.safe_count || 0),
        suspiciousCount: acc.suspiciousCount + (row.suspicious_count || 0),
        highRiskCount: acc.highRiskCount + (row.high_risk_count || 0),
      }),
      { totalChecks: 0, safeCount: 0, suspiciousCount: 0, highRiskCount: 0 }
    );

    return NextResponse.json(totals, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch {
    return NextResponse.json({ totalChecks: 0 }, { status: 200 });
  }
}
