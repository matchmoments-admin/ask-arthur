import { NextRequest, NextResponse } from "next/server";
import { guardV1 } from "@/lib/v1-guard";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { peekMonthlyQuota } from "@/lib/v1-quota";
import { documentAllowanceForOrg } from "@/lib/document-allowance";

export async function GET(req: NextRequest) {
  const guard = await guardV1(req);
  if (!guard.ok) return guard.error;
  const auth = guard.auth;

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

    // Document-check monthly allowance (org-billed, UTC calendar months) —
    // surfaced here so a pilot can see remaining without a chargeable POST.
    // Same resolver as the metered route: doc-plan entitlement first, tier
    // fallback second.
    let documentChecks = null;
    if (auth.orgId) {
      const allowance = await documentAllowanceForOrg(auth.orgId, auth.tier);
      if (allowance.degraded && allowance.monthlyLimit === 0) {
        // Could not read the entitlement — say so rather than rendering the
        // block's absence, which reads as "no plan" (a cancellation look-
        // alike a paying pilot would escalate).
        documentChecks = { degraded: true };
      } else if (allowance.monthlyLimit > 0) {
        documentChecks = {
          monthlyLimit: allowance.monthlyLimit,
          plan: allowance.plan,
          source: allowance.source,
          ...(allowance.degraded ? { degraded: true } : {}),
          ...((await peekMonthlyQuota(
            "document_check",
            auth.orgId,
            allowance.monthlyLimit,
          )) ?? { used: null, remaining: null }),
        };
      }
    }

    return NextResponse.json({
      period: { days, since: since.toISOString().slice(0, 10) },
      totalCalls,
      dailyRemaining: auth.dailyRemaining,
      documentChecks,
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
