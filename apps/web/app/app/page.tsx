import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import {
  getDashboardKPIs,
  getScamTypeBreakdown,
  getChannelSplit,
  getRecentThreats,
  getRecentScans,
} from "@/lib/dashboard";
import KPICards from "@/components/dashboard/KPICards";
import ScamTypeBreakdown from "@/components/dashboard/ScamTypeBreakdown";
import SourceSplit from "@/components/dashboard/SourceSplit";
import ThreatFeed from "@/components/dashboard/ThreatFeed";
import ComplianceChecklist from "@/components/dashboard/ComplianceChecklist";
import RecentScans from "@/components/dashboard/RecentScans";
import ChecksChart from "@/components/dashboard/ChecksChart";
import EntityFrequency from "@/components/dashboard/EntityFrequency";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { createServiceClient } from "@askarthur/supabase/server";

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

  const [kpis, scamTypes, channels, threats, scans, checkTimeSeries] = await Promise.all([
    getDashboardKPIs(7),
    getScamTypeBreakdown(30),
    getChannelSplit(),
    getRecentThreats(8),
    getRecentScans(6),
    getCheckTimeSeries(30),
  ]);

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
        style={{
          padding: "20px 28px 32px",
          gap: 20,
          maxWidth: 1280,
        }}
      >
        {/* Row 1: KPI Cards */}
        <KPICards kpis={kpis} />

        {/* Row 2: Charts — Checks Over Time + Scam Type Breakdown */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div
            className="bg-white"
            style={{
              border: "1px solid #eef0f3",
              borderRadius: 12,
              padding: 22,
            }}
          >
            <div className="mb-4">
              <h2 className="text-[15px] font-semibold text-deep-navy tracking-tight">
                Checks over time
              </h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Detected vs prevented · last 30 days
              </p>
            </div>
            <ChecksChart data={checkTimeSeries} />
          </div>
          <ScamTypeBreakdown data={scamTypes} />
        </div>

        {/* Row 3: Source Split + Compliance */}
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SourceSplit data={channels} />
          </div>
          <div className="lg:col-span-3">
            <ComplianceChecklist />
          </div>
        </div>

        {/* Row 4: Threat Feed + Entity Frequency */}
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ThreatFeed entities={threats} />
          </div>
          <div className="lg:col-span-2">
            <EntityFrequency entities={threats} />
          </div>
        </div>

        {/* Row 5: Recent Scans (full width) */}
        <RecentScans scans={scans} />
      </div>
    </>
  );
}
