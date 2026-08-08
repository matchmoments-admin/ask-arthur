import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import CostsDashboard from "./CostsDashboard";
import QueryErrorBand from "@/components/admin/QueryErrorBand";

export const dynamic = "force-dynamic";

interface DailyRow {
  day: string;
  feature: string;
  provider: string;
  event_count: number;
  total_cost_usd: number;
  avg_cost_usd: number;
}

function thirtyDaysAgoIsoDate(): string {
  return new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
}

function getNowMs(): number {
  return Date.now();
}

export default async function CostsPage() {
  await requireAdmin();

  // #945: a failed query must never render as a healthy empty state.
  const loadErrors: string[] = [];

  const supabase = createServiceClient();
  let todayCostUsd = 0;
  let todayEventCount = 0;
  let daily: DailyRow[] = [];

  if (supabase) {
    const { data: today, error: qe1 } = await supabase
      .from("today_cost_total")
      .select("total_cost_usd, event_count")
      .single();
    if (qe1 && qe1.code !== "PGRST116") loadErrors.push("today's spend");

    todayCostUsd = Number(today?.total_cost_usd ?? 0);
    todayEventCount = Number(today?.event_count ?? 0);

    const thirtyDaysAgo = thirtyDaysAgoIsoDate();

    const { data, error: qe2 } = await supabase
      .from("daily_cost_summary")
      .select("day, feature, provider, event_count, total_cost_usd, avg_cost_usd")
      .gte("day", thirtyDaysAgo)
      .order("day", { ascending: false });
    if (qe2 && qe2.code !== "PGRST116") loadErrors.push("page data");

    daily = (data ?? []).map((r) => ({
      day: r.day as string,
      feature: r.feature as string,
      provider: r.provider as string,
      event_count: Number(r.event_count),
      total_cost_usd: Number(r.total_cost_usd),
      avg_cost_usd: Number(r.avg_cost_usd),
    }));
  }

  // Aggregate the last 7 COMPLETE UTC days vs the prior 7 for the WoW delta.
  // Today's partial day is excluded from both windows: comparing "6 complete
  // days + a few hours" against 7 complete days let the partial day dominate
  // the tile (-23.5% shown vs -2.8% on complete weeks, measured 2026-08-07 —
  // #941 finding 5, the 8-vs-7 digest precedent's sibling).
  const now = getNowMs();
  const dayMs = 86400000;
  const isWithin = (dayStr: string, startMs: number, endMs: number) => {
    const t = new Date(dayStr + "T00:00:00Z").getTime();
    return t >= startMs && t < endMs;
  };
  const todayUtcStart = Math.floor(now / dayMs) * dayMs;
  const sevenDaysAgo = todayUtcStart - 7 * dayMs;
  const fourteenDaysAgo = todayUtcStart - 14 * dayMs;

  const last7Total = daily
    .filter((r) => isWithin(r.day, sevenDaysAgo, todayUtcStart))
    .reduce((s, r) => s + Number(r.total_cost_usd), 0);

  const prev7Total = daily
    .filter((r) => isWithin(r.day, fourteenDaysAgo, sevenDaysAgo))
    .reduce((s, r) => s + Number(r.total_cost_usd), 0);

  const wowDeltaPct =
    prev7Total === 0
      ? last7Total > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : ((last7Total - prev7Total) / prev7Total) * 100;

  // Top 5 features by total cost over last 30 days.
  const featureAgg = new Map<string, { cost: number; events: number; provider: string }>();
  for (const r of daily) {
    const key = `${r.feature}|${r.provider}`;
    const prev = featureAgg.get(key) ?? { cost: 0, events: 0, provider: r.provider };
    featureAgg.set(key, {
      cost: prev.cost + Number(r.total_cost_usd),
      events: prev.events + Number(r.event_count),
      provider: r.provider,
    });
  }
  const topFeatures = Array.from(featureAgg.entries())
    .map(([key, v]) => ({
      feature: key.split("|")[0],
      provider: v.provider,
      total_cost_usd: v.cost,
      event_count: v.events,
    }))
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 5);

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <QueryErrorBand errors={loadErrors} />
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">Cost telemetry</h1>
      <p className="text-gov-slate text-sm mb-6">
        Per-call AI / paid-API spend. Rows are written fire-and-forget by
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
          logCost()
        </code>
        on successful analyses. Missing entries mean either the provider free tier or an
        un-instrumented code path.
      </p>
      <CostsDashboard
        todayCostUsd={todayCostUsd}
        todayEventCount={todayEventCount}
        last7Total={last7Total}
        prev7Total={prev7Total}
        wowDeltaPct={wowDeltaPct}
        topFeatures={topFeatures}
        daily={daily}
      />
    </div>
  );
}
