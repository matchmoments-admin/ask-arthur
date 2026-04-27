import type { ScamTypeRow } from "@/lib/dashboard";
import { getCategoryLabel } from "@/lib/dashboard";

interface SafeScamTypesProps {
  data: ScamTypeRow[];
  primary?: string;
}

export default function SafeScamTypes({
  data,
  primary = "var(--color-deep-navy)",
}: SafeScamTypesProps) {
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
            Top scam types
          </h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Last 30 days · by volume
          </p>
        </div>
        <span
          className="text-[11px] text-slate-500"
          style={{
            background: "#fff",
            border: "1px solid #eef0f3",
            borderRadius: 6,
            padding: "4px 8px",
          }}
        >
          30d
        </span>
      </header>

      <div style={{ padding: "0 22px 22px" }}>
        {data.length === 0 ? (
          <p className="text-[12px] text-slate-400 py-4">No data yet.</p>
        ) : (
          (() => {
            const max = data[0]?.count || 1;
            const top = data.slice(0, 6);
            return top.map((row, ix) => {
              const widthPct = (row.count / max) * 100;
              const isLast = ix === top.length - 1;
              return (
                <div
                  key={row.category}
                  style={{
                    padding: "10px 0",
                    borderBottom: isLast ? "none" : "1px solid #f1f5f9",
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3 mb-1.5">
                    <span className="text-[13px] font-medium text-deep-navy truncate">
                      {getCategoryLabel(row.category)}
                    </span>
                    <span
                      className="text-[13px] text-deep-navy"
                      style={{
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, monospace",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {row.count.toLocaleString()}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: "#f1f5f9",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${widthPct}%`,
                        background: primary,
                        borderRadius: 4,
                      }}
                    />
                  </div>
                </div>
              );
            });
          })()
        )}
      </div>
    </section>
  );
}
