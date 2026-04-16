"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import type { ExecutiveKPIs } from "@/lib/dashboard/executive";

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

interface Props {
  kpis: ExecutiveKPIs;
}

export default function ROISummary({ kpis }: Props) {
  const cards = [
    {
      label: "Estimated Losses Prevented",
      value: formatCurrency(kpis.estimatedLossesPrevented),
      trend: kpis.monthOverMonthChange,
      trendLabel: "vs last month",
      positive: true,
      bgClass: "bg-emerald-50/50",
    },
    {
      label: "Compliance Score",
      value: `${kpis.complianceScore}%`,
      trend: null,
      trendLabel: "SPF framework aligned",
      positive: true,
      bgClass: "bg-blue-50/50",
    },
    {
      label: "Penalty Exposure",
      value: kpis.penaltyExposure.split(" — ")[0],
      trend: null,
      trendLabel: kpis.penaltyExposure.includes(" — ")
        ? kpis.penaltyExposure.split(" — ")[1]
        : "",
      positive: true,
      bgClass: "bg-slate-50",
    },
    {
      label: "Month-over-Month Change",
      value: `${kpis.monthOverMonthChange > 0 ? "+" : ""}${kpis.monthOverMonthChange}%`,
      trend: kpis.monthOverMonthChange,
      trendLabel: "threat detection growth",
      positive: kpis.monthOverMonthChange > 0,
      bgClass: "bg-teal-50/50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`${card.bgClass} border border-border-light rounded-xl px-6 py-5`}
        >
          <p className="text-xs font-medium uppercase tracking-wider text-gov-slate mb-2">
            {card.label}
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="text-3xl font-bold text-deep-navy"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {card.value}
            </span>
            {card.trend !== null && (
              <span className="flex items-center gap-1">
                {card.positive ? (
                  <TrendingUp size={14} className="text-emerald-600" />
                ) : (
                  <TrendingDown size={14} className="text-red-500" />
                )}
                <span
                  className={`text-xs font-medium ${
                    card.positive ? "text-emerald-600" : "text-red-500"
                  }`}
                >
                  {card.trend > 0 ? "+" : ""}
                  {card.trend}%
                </span>
              </span>
            )}
          </div>
          {card.trendLabel && (
            <p className="text-[11px] text-slate-400 mt-1">{card.trendLabel}</p>
          )}
        </div>
      ))}
    </div>
  );
}
