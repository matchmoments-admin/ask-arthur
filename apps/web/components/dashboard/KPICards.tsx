import type { DashboardKPIs } from "@/lib/dashboard";

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return n.toLocaleString();
  return String(n);
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n}`;
}

function delta(
  current: number,
  previous: number,
): { text: string; up: boolean } | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { text: `${pct > 0 ? "+" : ""}${pct}%`, up: pct > 0 };
}

interface Card {
  label: string;
  value: string;
  sub?: string;
  delta?: { text: string; up: boolean } | null;
  /** When true, an "up" delta is good (green). When false, an "up" delta is bad (red). */
  goodWhenUp?: boolean;
}

export default function KPICards({ kpis }: { kpis: DashboardKPIs }) {
  const cards: Card[] = [
    {
      label: "Checks (7d)",
      value: formatNum(kpis.totalChecks),
      sub: "vs prev 7d",
      delta: delta(kpis.totalChecks, kpis.prevTotalChecks),
      goodWhenUp: true,
    },
    {
      label: "High-risk (7d)",
      value: formatNum(kpis.highRiskCount),
      sub: "blocked or flagged",
      delta: delta(kpis.highRiskCount, kpis.prevHighRiskCount),
      goodWhenUp: false,
    },
    {
      label: "Losses prevented",
      value: formatMoney(kpis.estimatedLossesPrevented),
      sub: "based on avg $540 / scam",
    },
    {
      label: "Intelligence items",
      value: formatNum(kpis.feedItemCount + kpis.entityCount),
      sub: `${kpis.feedItemCount.toLocaleString()} feed · ${kpis.entityCount.toLocaleString()} entities`,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map((card) => {
        const deltaIsGood =
          card.delta &&
          ((card.delta.up && card.goodWhenUp) ||
            (!card.delta.up && card.goodWhenUp === false));
        const deltaPillBg = deltaIsGood ? "#f0fdf4" : "#fef2f2";
        const deltaPillFg = deltaIsGood ? "#16a34a" : "#dc2626";

        return (
          <div
            key={card.label}
            className="bg-white flex flex-col"
            style={{
              border: "1px solid #eef0f3",
              borderRadius: 10,
              padding: 18,
              minHeight: 120,
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] font-medium text-slate-500">
                {card.label}
              </span>
              {card.delta ? (
                <span
                  className="inline-flex items-center gap-1 font-medium"
                  style={{
                    fontSize: 11,
                    color: deltaPillFg,
                    background: deltaPillBg,
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {card.delta.up ? "↑" : "↓"} {card.delta.text.replace(/[+\-]/g, "")}
                </span>
              ) : null}
            </div>
            <div
              className="text-deep-navy leading-none"
              style={{
                fontSize: 28,
                fontWeight: 500,
                letterSpacing: "-0.02em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {card.value}
            </div>
            {card.sub ? (
              <div className="text-[11px] text-slate-400 mt-auto pt-3">
                {card.sub}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
