"use client";

import { Shield, Eye, FileText, Siren, MessageSquareWarning, Landmark } from "lucide-react";
import type { ObligationStatus } from "@/lib/dashboard/compliance";

const PRINCIPLE_ICONS: Record<string, React.ElementType> = {
  Prevent: Shield,
  Detect: Eye,
  Report: FileText,
  Disrupt: Siren,
  Respond: MessageSquareWarning,
  Govern: Landmark,
};

const STATUS_COLORS: Record<ObligationStatus["status"], string> = {
  met: "bg-safe-green",
  partial: "bg-alert-amber",
  not_met: "bg-danger-red",
};

const STATUS_LABELS: Record<ObligationStatus["status"], string> = {
  met: "Met",
  partial: "Partial",
  not_met: "Not Met",
};

export default function ComplianceOverview({
  obligations,
}: {
  obligations: ObligationStatus[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {obligations.map((ob) => {
        const Icon = PRINCIPLE_ICONS[ob.principle] ?? Shield;
        return (
          <div
            key={ob.principle}
            className="bg-white border border-border-light rounded-xl shadow-sm px-5 py-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Icon size={16} className="text-trust-teal" />
                <h3 className="text-sm font-semibold text-deep-navy">
                  {ob.principle}
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_COLORS[ob.status]}`}
                />
                <span className="text-[10px] font-medium text-gov-slate uppercase tracking-wider">
                  {STATUS_LABELS[ob.status]}
                </span>
              </div>
            </div>

            <p className="text-xs text-gov-slate leading-relaxed mb-2">
              {ob.description}
            </p>

            <div className="bg-slate-50 rounded-lg px-3 py-2 mb-2">
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {ob.evidence}
              </p>
            </div>

            <p className="text-[10px] text-slate-400">
              Last checked:{" "}
              {new Date(ob.lastChecked).toLocaleDateString("en-AU", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
