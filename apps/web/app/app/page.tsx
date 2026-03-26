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
import RecentScans from "@/components/dashboard/RecentScans";
import Link from "next/link";

export default async function DashboardPage() {
  const user = await requireAuth();

  const [kpis, scamTypes, channels, threats, scans] = await Promise.all([
    getDashboardKPIs(7),
    getScamTypeBreakdown(30),
    getChannelSplit(),
    getRecentThreats(8),
    getRecentScans(6),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-deep-navy">
            {user.displayName ? `Welcome, ${user.displayName}` : "Dashboard"}
          </h1>
          <p className="text-xs text-slate-500">
            Threat intelligence overview — last 7 days
          </p>
        </div>
        <Link
          href="/app/keys"
          className="rounded-lg bg-deep-navy text-white text-xs font-medium px-4 py-2 hover:bg-navy transition-colors"
        >
          API Keys
        </Link>
      </div>

      {/* Row 1: KPI Cards */}
      <KPICards kpis={kpis} />

      {/* Row 2: Scam Types + Source Split */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ScamTypeBreakdown data={scamTypes} />
        </div>
        <div className="lg:col-span-2">
          <SourceSplit data={channels} />
        </div>
      </div>

      {/* Row 3: Threat Feed + Recent Scans */}
      <div className="grid gap-6 lg:grid-cols-5">
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
