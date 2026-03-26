import { MessageCircle, Flag, ShieldCheck, Shield } from "lucide-react";
import type { ChannelRow } from "@/lib/dashboard";
import { getSourceLabel } from "@/lib/dashboard";

const SOURCE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  reddit: MessageCircle,
  user_report: Flag,
  verified_scam: ShieldCheck,
  scamwatch: Shield,
};

export default function SourceSplit({ data }: { data: ChannelRow[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200/60 bg-white p-5">
        <h3 className="text-sm font-semibold text-deep-navy">Intelligence Sources</h3>
        <p className="text-xs text-slate-400 mt-4">No data yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200/60 bg-white p-5">
      <h3 className="text-sm font-semibold text-deep-navy mb-4">Intelligence Sources</h3>

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
        {data.map((row) => {
          const Icon = SOURCE_ICONS[row.channel] || Shield;
          return (
            <div key={row.channel} className="flex flex-col items-center px-3 py-4 bg-white">
              <Icon size={18} className="text-slate-400 mb-1.5" />
              <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                {getSourceLabel(row.channel)}
              </span>
              <span
                className="text-lg font-semibold text-deep-navy mt-1"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
              >
                {row.pct}%
              </span>
              <span
                className="text-[10px] text-slate-400"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
              >
                {row.count.toLocaleString()} items
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
