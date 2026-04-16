import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import {
  getOrgUsage,
  getEndpointBreakdown,
  getOrgApiKeys,
  getDeveloperKPIs,
} from "@/lib/dashboard/developer";
import { Activity, Key, Clock, AlertTriangle, ExternalLink } from "lucide-react";
import UsageChart from "@/components/dashboard/developer/UsageChart";
import EndpointBreakdown from "@/components/dashboard/developer/EndpointBreakdown";

export const metadata = {
  title: "Developer Dashboard — Ask Arthur",
};

const TIER_STYLES: Record<string, string> = {
  enterprise: "bg-purple-100 text-purple-700",
  pro: "bg-blue-100 text-blue-700",
  free: "bg-slate-100 text-slate-600",
};

function formatRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function DeveloperPage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);
  const orgId = org?.orgId ?? null;

  const [usage, endpoints, apiKeys] = await Promise.all([
    getOrgUsage(orgId, 30),
    getEndpointBreakdown(orgId),
    getOrgApiKeys(orgId),
  ]);

  const kpis = getDeveloperKPIs(usage, apiKeys, endpoints);

  const kpiCards = [
    {
      label: "Total API Calls (30d)",
      value: kpis.totalCalls30d.toLocaleString("en-AU"),
      icon: Activity,
    },
    {
      label: "Active Keys",
      value: String(kpis.activeKeys),
      icon: Key,
    },
    {
      label: "Avg Latency",
      value: `${kpis.avgLatencyMs}ms`,
      icon: Clock,
    },
    {
      label: "Error Rate",
      value: `${kpis.errorRate}%`,
      icon: AlertTriangle,
      alert: kpis.errorRate > 1,
    },
  ];

  return (
    <div className="p-6 max-w-[1200px]">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">
          Developer Dashboard
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          API usage analytics, key management, and integration tools
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpiCards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div
              key={kpi.label}
              className="bg-white border border-border-light rounded-xl shadow-sm px-5 py-4"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon
                  size={14}
                  className={
                    "alert" in kpi && kpi.alert
                      ? "text-red-500"
                      : "text-slate-400"
                  }
                />
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  {kpi.label}
                </p>
              </div>
              <span
                className={`text-2xl font-semibold ${
                  "alert" in kpi && kpi.alert
                    ? "text-red-600"
                    : "text-deep-navy"
                }`}
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

      {/* Usage Chart */}
      <div className="mt-6 bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
          API Usage (Last 30 Days)
        </h2>
        <UsageChart data={usage} />
      </div>

      {/* Endpoint Breakdown */}
      <div className="mt-6 bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
          Endpoint Breakdown
        </h2>
        <EndpointBreakdown data={endpoints} />
      </div>

      {/* API Keys + Quick Links */}
      <div className="grid gap-4 lg:grid-cols-3 mt-6">
        {/* API Keys */}
        <div className="lg:col-span-2 bg-white border border-border-light rounded-xl shadow-sm p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
            API Keys
          </h2>
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between py-2 border-b border-border-light/50 last:border-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-deep-navy truncate">
                    {key.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="text-[10px] text-slate-400 font-mono">
                      {key.key_prefix}...
                    </code>
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                        TIER_STYLES[key.tier] || TIER_STYLES.free
                      }`}
                    >
                      {key.tier}
                    </span>
                    <span
                      className={`inline-block w-1.5 h-1.5 rounded-full ${
                        key.status === "active"
                          ? "bg-emerald-500"
                          : "bg-slate-300"
                      }`}
                    />
                  </div>
                </div>
                <div className="text-right ml-4 shrink-0">
                  <p className="text-[10px] text-slate-400">Last used</p>
                  <p className="text-xs text-slate-600">
                    {formatRelative(key.last_used_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Links */}
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-5">
          <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-4">
            Quick Links
          </h2>
          <div className="space-y-3">
            <a
              href="/api/v1/openapi.json"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-lg border border-border-light hover:bg-slate-50 transition-colors group"
            >
              <ExternalLink
                size={16}
                className="text-trust-teal group-hover:text-teal-700 shrink-0"
              />
              <div>
                <p className="text-sm font-medium text-deep-navy">
                  API Documentation
                </p>
                <p className="text-[10px] text-slate-400">
                  OpenAPI spec and endpoint reference
                </p>
              </div>
            </a>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border-light bg-slate-50/50">
              <ExternalLink size={16} className="text-slate-300 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-400">
                  Integration Guide
                </p>
                <p className="text-[10px] text-slate-300">Coming soon</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
