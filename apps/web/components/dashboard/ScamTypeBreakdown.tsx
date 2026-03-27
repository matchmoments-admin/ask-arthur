import type { ScamTypeRow } from "@/lib/dashboard";
import { getCategoryLabel } from "@/lib/dashboard";

export default function ScamTypeBreakdown({ data }: { data: ScamTypeRow[] }) {
  if (data.length === 0) {
    return (
      <div className="bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-deep-navy">Scam Types</h3>
        <p className="text-xs text-slate-400 mt-4">No data yet.</p>
      </div>
    );
  }

  const maxCount = data[0]?.count || 1;

  return (
    <div className="bg-white border border-border-light rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-deep-navy">Top Scam Types</h3>
          <p className="text-xs text-slate-400">Last 30 days</p>
        </div>
      </div>

      <div className="space-y-3">
        {data.map((row) => (
          <div key={row.category}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-deep-navy truncate mr-2">
                {getCategoryLabel(row.category)}
              </span>
              <span
                className="text-slate-500 shrink-0"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
              >
                {row.count.toLocaleString()}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100">
              <div
                className="h-1.5 rounded-full bg-deep-navy transition-all"
                style={{ width: `${(row.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
