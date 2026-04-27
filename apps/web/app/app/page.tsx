import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import {
  getDashboardKPIs,
  getKpiTimeSeries,
  getScamTypeBreakdown,
  getRecentThreats,
  getTriageItems,
  getRecentActivity,
  getSpfPosture,
} from "@/lib/dashboard";
import { createServiceClient } from "@askarthur/supabase/server";
import KPICards from "@/components/dashboard/KPICards";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import SafeTrend from "@/components/dashboard/SafeTrend";
import SafeSpfPosture from "@/components/dashboard/SafeSpfPosture";
import SafeTriage from "@/components/dashboard/SafeTriage";
import SafeScamTypes from "@/components/dashboard/SafeScamTypes";
import SafeLiveActivity from "@/components/dashboard/SafeLiveActivity";
import SafeEntityTable from "@/components/dashboard/SafeEntityTable";

async function getCheckTimeSeries(days = 30) {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const { data } = await supabase
    .from("check_stats")
    .select("date, total_checks, high_risk_count")
    .gte("date", since)
    .order("date", { ascending: true });

  if (!data) return [];

  const byDate = new Map<string, { total: number; high_risk: number }>();
  for (const row of data) {
    const existing = byDate.get(row.date) || { total: 0, high_risk: 0 };
    byDate.set(row.date, {
      total: existing.total + (row.total_checks || 0),
      high_risk: existing.high_risk + (row.high_risk_count || 0),
    });
  }

  return Array.from(byDate.entries()).map(([date, vals]) => ({
    date,
    total: vals.total,
    high_risk: vals.high_risk,
  }));
}

export default async function DashboardPage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);

  const [
    kpis,
    kpiSeries,
    scamTypes,
    threats,
    checkTimeSeries,
    triage,
    activity,
  ] = await Promise.all([
    getDashboardKPIs(7),
    getKpiTimeSeries(30),
    getScamTypeBreakdown(30),
    getRecentThreats(8),
    getCheckTimeSeries(30),
    getTriageItems(6),
    getRecentActivity(7),
  ]);

  const spf = getSpfPosture();

  return (
    <>
      <DashboardHeader
        displayName={user.displayName}
        email={user.email}
        orgName={org?.orgName ?? null}
        hidePersonas={!org}
      />

      <div
        className="flex flex-col"
        style={{ padding: "20px 28px 32px", gap: 20, maxWidth: 1280 }}
      >
        {/* Row 1: KPI cards with sparklines */}
        <KPICards kpis={kpis} series={kpiSeries} />

        {/* Row 2: Trend chart (2/3) + SPF posture (1/3) */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div
            className="bg-white lg:col-span-2"
            style={{ border: "1px solid #eef0f3", borderRadius: 12, padding: 22 }}
          >
            <div className="flex items-start justify-between mb-4 gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-deep-navy tracking-tight">
                  Threats over time
                </h2>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  Detected vs high-risk · last 30 days
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 2,
                      background: "var(--color-deep-navy)",
                      borderRadius: 1,
                    }}
                  />
                  Detected
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 0,
                      borderTop: "1.5px dashed #3B82F6",
                    }}
                  />
                  High-risk
                </span>
              </div>
            </div>
            <SafeTrend data={checkTimeSeries} />
          </div>
          <SafeSpfPosture
            principles={spf.principles}
            overallPct={spf.overallPct}
          />
        </div>

        {/* Row 3: Needs attention triage (60%) + Top scam types (40%) */}
        <div
          className="grid gap-4 lg:grid-cols-5"
        >
          <div className="lg:col-span-3">
            <SafeTriage items={triage} />
          </div>
          <div className="lg:col-span-2">
            <SafeScamTypes data={scamTypes} />
          </div>
        </div>

        {/* Row 4: Live activity (45%) + High-risk entities table (55%) */}
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SafeLiveActivity items={activity} />
          </div>
          <div className="lg:col-span-3">
            <SafeEntityTable entities={threats} />
          </div>
        </div>
      </div>
    </>
  );
}
