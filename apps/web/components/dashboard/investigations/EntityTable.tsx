"use client";

import { Globe, Phone, Mail, Server, Wifi } from "lucide-react";
import type { ThreatItem } from "@/lib/dashboard/investigations";

const ENTITY_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  url: Globe,
  phone: Phone,
  email: Mail,
  domain: Server,
  ip: Wifi,
};

const RISK_STYLES: Record<string, string> = {
  CRITICAL: "bg-red-900 text-white",
  HIGH: "bg-red-100 text-red-700",
  MEDIUM: "bg-amber-100 text-amber-700",
  LOW: "bg-green-100 text-green-700",
};

function truncate(value: string, max: number = 40): string {
  return value.length > max ? value.slice(0, max) + "..." : value;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface Props {
  threats: ThreatItem[];
}

export default function EntityTable({ threats }: Props) {
  if (threats.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-400">
        No entities detected yet
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-light">
            <th className="text-left py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Type
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Entity
            </th>
            <th className="text-left py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Risk
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Score
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Reports
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              First Seen
            </th>
            <th className="text-right py-2.5 px-3 text-xs font-medium uppercase tracking-wider text-slate-500">
              Last Seen
            </th>
          </tr>
        </thead>
        <tbody>
          {threats.map((threat) => {
            const Icon = ENTITY_ICONS[threat.entity_type] || Globe;
            const riskStyle = RISK_STYLES[threat.risk_level] || RISK_STYLES.MEDIUM;

            return (
              <tr
                key={threat.id}
                className="border-b border-border-light/50 hover:bg-slate-50/50 transition-colors"
              >
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1.5">
                    <Icon size={14} className="text-slate-400" />
                    <span className="text-xs text-slate-500 capitalize">
                      {threat.entity_type}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3">
                  <span
                    className="text-deep-navy font-mono text-xs"
                    title={threat.normalized_value}
                  >
                    {truncate(threat.normalized_value)}
                  </span>
                </td>
                <td className="py-2.5 px-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${riskStyle}`}
                  >
                    {threat.risk_level}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span
                    className="text-xs font-medium text-deep-navy"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {threat.risk_score}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span
                    className="text-xs text-slate-600"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {threat.report_count.toLocaleString("en-AU")}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className="text-xs text-slate-400">
                    {formatDate(threat.first_seen)}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className="text-xs text-slate-400">
                    {formatDate(threat.last_seen)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
