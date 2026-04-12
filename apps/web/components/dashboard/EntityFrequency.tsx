import type { ThreatEntity } from "@/lib/dashboard";

const TYPE_LABEL: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  url: "URL",
  domain: "Domain",
  ip: "IP",
  crypto_wallet: "Crypto",
};

export default function EntityFrequency({ entities }: { entities: ThreatEntity[] }) {
  if (entities.length === 0) {
    return (
      <div className="bg-white border border-border-light rounded-xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-deep-navy">Top Reported Entities</h3>
        <p className="text-xs text-slate-400 mt-4">No entity data yet.</p>
      </div>
    );
  }

  // Sort by report count descending
  const sorted = [...entities].sort((a, b) => b.report_count - a.report_count).slice(0, 15);

  return (
    <div className="bg-white border border-border-light rounded-xl shadow-sm">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-deep-navy">Top Reported Entities</h3>
        <p className="text-[10px] text-slate-400 mt-0.5">Most reported this period</p>
      </div>

      <div className="divide-y divide-slate-100/80">
        {sorted.map((entity, i) => (
          <div key={entity.id} className="flex items-center gap-3 px-5 py-2.5">
            <span
              className="text-[10px] text-slate-300 w-4 text-right shrink-0"
              style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
            >
              {i + 1}
            </span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-500"
              style={{ fontFamily: "ui-monospace, monospace" }}
            >
              {TYPE_LABEL[entity.entity_type] || entity.entity_type}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-sm text-deep-navy"
              style={{ fontFamily: "ui-monospace, monospace" }}
            >
              {entity.normalized_value}
            </span>
            <span
              className="shrink-0 text-xs font-medium text-slate-500"
              style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
            >
              {entity.report_count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
