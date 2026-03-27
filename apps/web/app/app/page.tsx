import { requireAuth } from "@/lib/auth";
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

  // Aggregate by date
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
  await requireAuth();

  const [kpis, scamTypes, channels, threats, scans, checkTimeSeries] = await Promise.all([
    getDashboardKPIs(7),
    getScamTypeBreakdown(30),
    getChannelSplit(),
    getRecentThreats(8),
    getRecentScans(6),
    getCheckTimeSeries(30),
  ]);

  return (
    <div className="p-6 max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">Overview</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Real-time scam intelligence — Australian threat landscape
        </p>
      </div>

      {/* Row 1: KPI Cards */}
      <KPICards kpis={kpis} />

      {/* Row 2: Charts — Checks Over Time + Scam Type Breakdown */}
      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
            Checks Over Time (30d)
          </h2>
          <ChecksChart data={checkTimeSeries} />
        </div>
        <ScamTypeBreakdown data={scamTypes} />
      </div>

      {/* Row 3: Source Split + Compliance */}
      <div className="grid gap-4 lg:grid-cols-5 mt-6">
        <div className="lg:col-span-2">
          <SourceSplit data={channels} />
        </div>
        <div className="lg:col-span-3">
          <ComplianceChecklist />
        </div>
      </div>

      {/* Row 4: Threat Feed + Recent Scans */}
      <div className="grid gap-4 lg:grid-cols-5 mt-6">
        <div className="lg:col-span-3">
          <ThreatFeed entities={threats} />
        </div>
        <div className="lg:col-span-2">
          <RecentScans scans={scans} />
        </div>
      </div>
    </div>
  );
}
