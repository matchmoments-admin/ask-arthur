"use client";

interface DailyRow {
  day: string;
  feature: string;
  provider: string;
  event_count: number;
  total_cost_usd: number;
  avg_cost_usd: number;
}

interface FeatureRow {
  feature: string;
  provider: string;
  total_cost_usd: number;
  event_count: number;
}

interface Props {
  todayCostUsd: number;
  todayEventCount: number;
  last7Total: number;
  prev7Total: number;
  wowDeltaPct: number;
  topFeatures: FeatureRow[];
  daily: DailyRow[];
}

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const count = new Intl.NumberFormat("en-US");

function formatDelta(pct: number): string {
  if (!isFinite(pct)) return pct > 0 ? "new spend" : "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function deltaColor(pct: number): string {
  if (!isFinite(pct)) return "text-gov-slate";
  if (pct > 50) return "text-danger-text";
  if (pct > 0) return "text-warn-text";
  return "text-safe-green";
}

export default function CostsDashboard({
  todayCostUsd,
  todayEventCount,
  last7Total,
  prev7Total,
  wowDeltaPct,
  topFeatures,
  daily,
}: Props) {
  return (
    <div className="space-y-8">
      {/* Top-line numbers */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            Today
          </p>
          <p className="mt-1 text-2xl font-extrabold text-deep-navy">
            {usd.format(todayCostUsd)}
          </p>
          <p className="mt-1 text-xs text-gov-slate">
            {count.format(todayEventCount)} events
          </p>
        </div>
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            Last 7 days
          </p>
          <p className="mt-1 text-2xl font-extrabold text-deep-navy">
            {usd.format(last7Total)}
          </p>
          <p className="mt-1 text-xs text-gov-slate">
            Previous week: {usd.format(prev7Total)}
          </p>
        </div>
        <div className="rounded-xl border border-border-light bg-white p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
            Week-over-week
          </p>
          <p className={`mt-1 text-2xl font-extrabold ${deltaColor(wowDeltaPct)}`}>
            {formatDelta(wowDeltaPct)}
          </p>
          <p className="mt-1 text-xs text-gov-slate">
            {wowDeltaPct >= 0 ? "spending more" : "spending less"} this week
          </p>
        </div>
      </div>

      {/* Top features (30 days) */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gov-slate">
          Top features — last 30 days
        </h2>
        <div className="overflow-hidden rounded-xl border border-border-light bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Feature</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5 text-right">Events</th>
                <th className="px-4 py-2.5 text-right">Total USD</th>
              </tr>
            </thead>
            <tbody>
              {topFeatures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gov-slate">
                    No cost events in the last 30 days.
                  </td>
                </tr>
              ) : (
                topFeatures.map((r, i) => (
                  <tr
                    key={`${r.feature}-${r.provider}`}
                    className="border-t border-border-light"
                  >
                    <td className="px-4 py-2.5 text-gov-slate">{i + 1}</td>
                    <td className="px-4 py-2.5 font-mono text-deep-navy">
                      {r.feature}
                    </td>
                    <td className="px-4 py-2.5 text-gov-slate">{r.provider}</td>
                    <td className="px-4 py-2.5 text-right text-deep-navy">
                      {count.format(r.event_count)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-deep-navy">
                      {usd.format(r.total_cost_usd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily breakdown (last 30 days) */}
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gov-slate">
          Daily breakdown — last 30 days
        </h2>
        <div className="overflow-hidden rounded-xl border border-border-light bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left">
              <tr className="text-xs font-semibold uppercase tracking-wide text-gov-slate">
                <th className="px-4 py-2.5">Day</th>
                <th className="px-4 py-2.5">Feature</th>
                <th className="px-4 py-2.5">Provider</th>
                <th className="px-4 py-2.5 text-right">Events</th>
                <th className="px-4 py-2.5 text-right">Total USD</th>
                <th className="px-4 py-2.5 text-right">Avg / event</th>
              </tr>
            </thead>
            <tbody>
              {daily.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gov-slate">
                    No cost events yet.
                  </td>
                </tr>
              ) : (
                daily.map((r, i) => (
                  <tr
                    key={`${r.day}-${r.feature}-${r.provider}-${i}`}
                    className="border-t border-border-light"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-gov-slate">
                      {r.day}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-deep-navy">
                      {r.feature}
                    </td>
                    <td className="px-4 py-2.5 text-gov-slate">{r.provider}</td>
                    <td className="px-4 py-2.5 text-right text-deep-navy">
                      {count.format(r.event_count)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-deep-navy">
                      {usd.format(r.total_cost_usd)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gov-slate">
                      {usd.format(r.avg_cost_usd)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
