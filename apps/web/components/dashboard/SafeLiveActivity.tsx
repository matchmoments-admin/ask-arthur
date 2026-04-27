import { Shield, Eye, FileText } from "lucide-react";
import type { ActivityItem } from "@/lib/dashboard";

const KIND_ICON: Record<ActivityItem["kind"], typeof Shield> = {
  scan: Shield,
  detect: Eye,
  report: FileText,
};

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function SafeLiveActivity({
  items,
}: {
  items: ActivityItem[];
}) {
  return (
    <section
      className="bg-white flex flex-col"
      style={{ border: "1px solid #eef0f3", borderRadius: 12 }}
    >
      <header
        className="flex items-start justify-between gap-4"
        style={{ padding: "22px 22px 14px" }}
      >
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight text-deep-navy m-0">
            Live activity
          </h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Real-time API and detection events
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "#16a34a",
              boxShadow: "0 0 0 3px rgba(22,163,74,0.18)",
            }}
          />
          Live
        </span>
      </header>

      <div style={{ padding: "0 22px 22px" }}>
        {items.length === 0 ? (
          <p className="text-[12px] text-slate-400 py-4">No recent activity.</p>
        ) : (
          items.map((item, ix) => {
            const Ic = KIND_ICON[item.kind];
            const isLast = ix === items.length - 1;
            return (
              <div
                key={item.id}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "32px 1fr auto",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: isLast ? "none" : "1px solid #f8fafc",
                }}
              >
                <span
                  className="grid place-items-center text-deep-navy"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: "#f8fafc",
                  }}
                  aria-hidden
                >
                  <Ic size={14} strokeWidth={1.7} />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] text-deep-navy">{item.text}</div>
                  <div
                    className="text-[11px] text-slate-400 truncate"
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {item.meta}
                  </div>
                </div>
                <span
                  className="text-[10px] text-slate-400 shrink-0"
                  style={{
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {formatAge(item.ageSeconds)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
