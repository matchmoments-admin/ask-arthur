import { ShieldAlert, Search, DollarSign, Database } from "lucide-react";
import type { DashboardKPIs } from "@/lib/dashboard";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function delta(current: number, previous: number): { text: string; positive: boolean } | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, positive: pct > 0 };
}

export default function KPICards({ kpis }: { kpis: DashboardKPIs }) {
  const checksDelta = delta(kpis.totalChecks, kpis.prevTotalChecks);
  const hrDelta = delta(kpis.highRiskCount, kpis.prevHighRiskCount);

  const cards = [
    {
      label: "Checks (7d)",
      value: formatNum(kpis.totalChecks),
      delta: checksDelta,
      deltaGoodWhenUp: true,
      icon: Search,
    },
    {
      label: "HIGH_RISK (7d)",
      value: formatNum(kpis.highRiskCount),
      delta: hrDelta,
      deltaGoodWhenUp: false,
      icon: ShieldAlert,
    },
    {
      label: "Est. Losses Prevented",
      value: formatNum(kpis.estimatedLossesPrevented),
      subtitle: "Based on avg $540 loss",
      icon: DollarSign,
    },
    {
      label: "Intelligence Items",
      value: formatNum(kpis.feedItemCount + kpis.entityCount),
      subtitle: `${kpis.feedItemCount} feed + ${kpis.entityCount} entities`,
      icon: Database,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-lg border border-slate-200/60 bg-white px-5 py-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon size={14} className="text-slate-400" />
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                {card.label}
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="text-2xl font-semibold text-deep-navy"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
              >
                {card.value}
              </span>
              {card.delta && (
                <span
                  className={`text-xs ${
                    (card.delta.positive && card.deltaGoodWhenUp) || (!card.delta.positive && !card.deltaGoodWhenUp)
                      ? "text-emerald-600"
                      : "text-red-500"
                  }`}
                  style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
                >
                  {card.delta.text}
                </span>
              )}
            </div>
            {card.subtitle && (
              <p className="text-[10px] text-slate-400 mt-0.5">{card.subtitle}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
