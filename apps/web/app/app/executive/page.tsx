import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import {
  getExecutiveKPIs,
  getMonthlyTrends,
} from "@/lib/dashboard/executive";
import { ShieldCheck } from "lucide-react";
import ROISummary from "@/components/dashboard/executive/ROISummary";
import TrendChart from "@/components/dashboard/executive/TrendChart";
import BoardReportButton from "@/components/dashboard/executive/BoardReportButton";

export const metadata = {
  title: "Executive Summary — Ask Arthur",
};

export default async function ExecutivePage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);
  const orgId = org?.orgId ?? null;

  const [kpis, trends] = await Promise.all([
    getExecutiveKPIs(orgId),
    getMonthlyTrends(orgId),
  ]);

  return (
    <div className="p-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-deep-navy">
            Executive Summary
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            High-level ROI, compliance posture, and threat trends
          </p>
        </div>
        <BoardReportButton />
      </div>

      {/* ROI Summary — 2x2 KPI cards */}
      <ROISummary kpis={kpis} />

      {/* Trend Chart */}
      <div className="mt-6 bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
          6-Month Trend — Threats Detected vs Losses Prevented
        </h2>
        <TrendChart data={trends} />
      </div>

      {/* Compliance Posture + Protection Stats */}
      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        {/* Compliance Gauge */}
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
            SPF Compliance Posture
          </h2>
          <div className="flex items-center justify-center py-6">
            <div className="relative w-40 h-40">
              {/* Background circle */}
              <svg
                className="w-full h-full -rotate-90"
                viewBox="0 0 120 120"
              >
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke={
                    kpis.complianceScore >= 90
                      ? "#059669"
                      : kpis.complianceScore >= 70
                        ? "#D97706"
                        : "#DC2626"
                  }
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${(kpis.complianceScore / 100) * 327} 327`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="text-3xl font-bold text-deep-navy"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {kpis.complianceScore}%
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                  Compliant
                </span>
              </div>
            </div>
          </div>
          <p className="text-xs text-center text-slate-500">
            Scam Prevention Framework alignment score
          </p>
        </div>

        {/* Protection Summary */}
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-6">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
            Protection Summary
          </h2>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                  <ShieldCheck size={16} className="text-trust-teal" />
                </div>
                <div>
                  <p className="text-sm font-medium text-deep-navy">
                    Threats Detected
                  </p>
                  <p className="text-[10px] text-slate-400">This month</p>
                </div>
              </div>
              <span
                className="text-xl font-bold text-deep-navy"
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {kpis.threatsDetected.toLocaleString("en-AU")}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <ShieldCheck size={16} className="text-safe-green" />
                </div>
                <div>
                  <p className="text-sm font-medium text-deep-navy">
                    Threats Blocked
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {kpis.threatsDetected > 0
                      ? `${((kpis.threatsBlocked / kpis.threatsDetected) * 100).toFixed(1)}% block rate`
                      : "No data"}
                  </p>
                </div>
              </div>
              <span
                className="text-xl font-bold text-deep-navy"
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {kpis.threatsBlocked.toLocaleString("en-AU")}
              </span>
            </div>

            <div className="pt-3 border-t border-border-light">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Penalty Exposure Assessment
                </p>
                <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
                  {kpis.penaltyExposure.split(" — ")[0]}
                </span>
              </div>
              {kpis.penaltyExposure.includes(" — ") && (
                <p className="text-[10px] text-slate-400 mt-1">
                  {kpis.penaltyExposure.split(" — ")[1]}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
