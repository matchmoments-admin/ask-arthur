import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { TriageItem } from "@/lib/dashboard";

const SEV_COLORS: Record<
  TriageItem["severity"],
  { bg: string; fg: string; dot: string }
> = {
  critical: { bg: "#FEF2F2", fg: "#991B1B", dot: "#DC2626" },
  high: { bg: "#FFF7ED", fg: "#9A3412", dot: "#EA580C" },
  medium: { bg: "#FEFCE8", fg: "#854D0E", dot: "#CA8A04" },
};

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function SafeTriage({ items }: { items: TriageItem[] }) {
  const totalCount = items.length;

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
            Needs attention
          </h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            High-risk entities seen in the last 24 hours
          </p>
        </div>
        {totalCount > 0 ? (
          <Link
            href="/app/threats"
            className="text-[12px] font-medium text-deep-navy hover:underline shrink-0"
          >
            View all →
          </Link>
        ) : null}
      </header>

      <div style={{ padding: "0 22px 22px" }}>
        {items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{
              padding: "36px 12px",
              border: "1px dashed #eef0f3",
              borderRadius: 10,
              background: "#fbfbfa",
            }}
          >
            <div
              className="grid place-items-center mb-2"
              style={{
                width: 32,
                height: 32,
                borderRadius: 999,
                background: "#ecfdf5",
                color: "#16a34a",
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <div className="text-[13px] font-medium text-deep-navy">
              All clear
            </div>
            <div className="text-[12px] text-slate-500 mt-0.5">
              No high-risk entities in the last 24 hours.
            </div>
          </div>
        ) : (
          items.map((item, ix) => {
            const c = SEV_COLORS[item.severity];
            const isLast = ix === items.length - 1;
            return (
              <div
                key={item.id}
                className="grid items-center"
                style={{
                  gridTemplateColumns: "8px 1fr auto",
                  gap: 14,
                  padding: "12px 0",
                  borderBottom: isLast ? "none" : "1px solid #f1f5f9",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: c.dot,
                  }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: c.fg,
                        background: c.bg,
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {item.severity}
                    </span>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider text-slate-400"
                    >
                      {item.kind}
                    </span>
                  </div>
                  <div
                    className="text-[13px] font-medium text-deep-navy truncate"
                    title={item.title}
                  >
                    {item.title}
                  </div>
                  <div className="text-[12px] text-slate-500 truncate">
                    {item.detail}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className="text-[11px] text-slate-400"
                    style={{
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {formatAge(item.ageMinutes)} ago
                  </span>
                  <ChevronRight size={14} strokeWidth={1.6} className="text-slate-300" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
