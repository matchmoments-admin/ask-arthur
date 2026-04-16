import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import {
  getOrgThreats,
  getOrgClusters,
  getThreatBreakdown,
} from "@/lib/dashboard/investigations";
import type { ClusterSummary } from "@/lib/dashboard/investigations";
import { ShieldAlert, Target, Network, Gauge } from "lucide-react";
import ThreatBreakdown from "@/components/dashboard/investigations/ThreatBreakdown";
import EntityTable from "@/components/dashboard/investigations/EntityTable";

export const metadata = {
  title: "Threat Investigations — Ask Arthur",
};

function RiskBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    CRITICAL: "bg-red-900 text-white",
    HIGH: "bg-red-100 text-red-700",
    MEDIUM: "bg-amber-100 text-amber-700",
    LOW: "bg-green-100 text-green-700",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${styles[level] || styles.MEDIUM}`}
    >
      {level}
    </span>
  );
}

function ClusterCard({ cluster }: { cluster: ClusterSummary }) {
  return (
    <div className="bg-white border border-border-light rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-sm font-semibold text-deep-navy">{cluster.name}</h3>
        <RiskBadge level={cluster.risk_level} />
      </div>
      {cluster.description && (
        <p className="text-xs text-slate-500 mb-3 line-clamp-2">
          {cluster.description}
        </p>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Network size={12} className="text-slate-400" />
          <span className="text-xs text-slate-600">
            {cluster.member_count} linked entities
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          {new Date(cluster.created_at).toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short",
          })}
        </span>
      </div>
    </div>
  );
}

export default async function InvestigationsPage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);
  const orgId = org?.orgId ?? null;

  const [threats, clusters, breakdown] = await Promise.all([
    getOrgThreats(orgId, 30),
    getOrgClusters(orgId),
    getThreatBreakdown(orgId),
  ]);

  // KPI calculations
  const activeThreats = threats.length;
  const criticalEntities = threats.filter(
    (t) => t.risk_level === "CRITICAL" || t.risk_level === "HIGH"
  ).length;
  const clusterCount = clusters.length;
  const avgRiskScore =
    threats.length > 0
      ? Math.round(
          threats.reduce((sum, t) => sum + t.risk_score, 0) / threats.length
        )
      : 0;

  const kpis = [
    {
      label: "Active Threats",
      value: activeThreats.toLocaleString("en-AU"),
      icon: ShieldAlert,
    },
    {
      label: "Critical Entities",
      value: criticalEntities.toLocaleString("en-AU"),
      icon: Target,
    },
    {
      label: "Scam Clusters",
      value: clusterCount.toLocaleString("en-AU"),
      icon: Network,
    },
    {
      label: "Avg Risk Score",
      value: String(avgRiskScore),
      icon: Gauge,
    },
  ];

  return (
    <div className="p-6 max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">
          Threat Investigations
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Entity-level threat intelligence and cluster analysis
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="bg-white border border-border-light rounded-xl shadow-sm px-5 py-4"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className="text-slate-400" />
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  {kpi.label}
                </p>
              </div>
              <span
                className="text-2xl font-semibold text-deep-navy"
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {kpi.value}
              </span>
            </div>
          );
        })}
      </div>

      {/* Threat Breakdown Chart */}
      <div className="mt-6 bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
          Threat Breakdown by Entity Type
        </h2>
        <ThreatBreakdown data={breakdown} />
      </div>

      {/* Entity Table */}
      <div className="mt-6 bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
          Detected Entities
        </h2>
        <EntityTable threats={threats} />
      </div>

      {/* Cluster Summary */}
      <div className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
          Active Scam Clusters
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {clusters.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} />
          ))}
        </div>
      </div>
    </div>
  );
}
