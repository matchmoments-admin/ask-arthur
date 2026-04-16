import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import {
  getComplianceKPIs,
  getObligationStatus,
  getComplianceTimeline,
  getEvidenceItems,
} from "@/lib/dashboard/compliance";
import type { ComplianceKPIs } from "@/lib/dashboard/compliance";
import {
  ShieldCheck,
  ShieldAlert,
  Zap,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import ComplianceOverview from "@/components/dashboard/compliance/ComplianceOverview";
import ComplianceChart from "@/components/dashboard/compliance/ComplianceChart";
import EvidenceLog from "@/components/dashboard/compliance/EvidenceLog";

function KPICard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="bg-white border border-border-light rounded-xl shadow-sm px-5 py-4">
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={color ?? "text-slate-400"} />
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
          {label}
        </p>
      </div>
      <span
        className="text-2xl font-semibold text-deep-navy"
        style={{
          fontVariantNumeric: "tabular-nums",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function formatKPIValue(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-safe-green";
  if (score >= 50) return "text-alert-amber";
  return "text-danger-red";
}

export default async function CompliancePage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);
  const orgId = org?.orgId ?? null;

  const [kpis, obligations, timeline, evidence] = await Promise.all([
    getComplianceKPIs(orgId),
    getObligationStatus(orgId),
    getComplianceTimeline(orgId, 30),
    getEvidenceItems(orgId),
  ]);

  const isDemo = !orgId;

  return (
    <div className="p-6 max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">
          SPF Compliance Dashboard
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {isDemo ? (
            <span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700 mr-1.5">
                Demo Mode
              </span>
              Showing sample data. Create an organisation to see real compliance metrics.
            </span>
          ) : (
            <>
              {org?.orgName} — Scams Prevention Framework Act 2025 compliance
              tracking and evidence.
            </>
          )}
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mb-8">
        <KPICard
          label="Threats Detected (30d)"
          value={formatKPIValue(kpis.totalThreatsDetected)}
          icon={ShieldCheck}
          color="text-trust-teal"
        />
        <KPICard
          label="High-Risk Blocked"
          value={formatKPIValue(kpis.highRiskBlocked)}
          icon={ShieldAlert}
          color="text-danger-red"
        />
        <KPICard
          label="Avg Response Time"
          value={kpis.avgResponseTime}
          icon={Zap}
          color="text-alert-amber"
        />
        <div className="bg-white border border-border-light rounded-xl shadow-sm px-5 py-4">
          <div className="flex items-center gap-2 mb-1">
            <BarChart3 size={14} className="text-slate-400" />
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Compliance Score
            </p>
          </div>
          <span
            className={`text-2xl font-semibold ${scoreColor(kpis.complianceScore)}`}
            style={{
              fontVariantNumeric: "tabular-nums",
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {kpis.complianceScore}%
          </span>
        </div>
      </div>

      {/* Obligation Tracker */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-deep-navy mb-3">
          SPF Obligation Tracker
        </h2>
        <ComplianceOverview obligations={obligations} />
      </div>

      {/* Compliance Activity Chart */}
      <div className="bg-white border border-border-light rounded-xl shadow-sm p-5 mb-8">
        <h2 className="text-sm font-semibold text-deep-navy mb-4">
          Compliance Activity — Last 30 Days
        </h2>
        <ComplianceChart data={timeline} />
      </div>

      {/* Evidence Log */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-deep-navy">
            Evidence Log
          </h2>
          <Link
            href="/app/compliance/evidence"
            className="inline-flex items-center gap-1 text-xs font-medium text-trust-teal hover:text-teal-700 transition-colors"
          >
            Full evidence export
            <ArrowRight size={12} />
          </Link>
        </div>
        <EvidenceLog items={evidence} />
      </div>
    </div>
  );
}
