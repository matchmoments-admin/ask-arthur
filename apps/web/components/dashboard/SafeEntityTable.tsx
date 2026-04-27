import Link from "next/link";
import { Globe, Mail, Phone, Server, Wifi } from "lucide-react";
import type { ThreatEntity } from "@/lib/dashboard";

const TYPE_ICON: Record<string, typeof Globe> = {
  url: Globe,
  email: Mail,
  phone: Phone,
  domain: Server,
  ip: Wifi,
};

function riskColors(risk: string) {
  switch (risk?.toUpperCase()) {
    case "CRITICAL":
      return { bg: "#FEF2F2", fg: "#991B1B" };
    case "HIGH":
      return { bg: "#FFF7ED", fg: "#9A3412" };
    case "MEDIUM":
      return { bg: "#FEFCE8", fg: "#854D0E" };
    case "LOW":
      return { bg: "#F0FDF4", fg: "#166534" };
    default:
      return { bg: "#F8FAFC", fg: "#475569" };
  }
}

export default function SafeEntityTable({
  entities,
}: {
  entities: ThreatEntity[];
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
            High-risk entities
          </h3>
          <p className="text-[12px] text-slate-500 mt-0.5">Top detected this week</p>
        </div>
        <Link
          href="/app/investigations"
          className="text-[12px] font-medium text-deep-navy hover:underline shrink-0"
        >
          Investigations →
        </Link>
      </header>

      <div style={{ padding: "0 22px 22px" }}>
        <div
          className="grid items-center text-[10px] font-semibold uppercase tracking-wider text-slate-400"
          style={{
            gridTemplateColumns: "70px 1fr 70px 60px",
            gap: 10,
            padding: "8px 0",
            borderBottom: "1px solid #eef0f3",
          }}
        >
          <span>Type</span>
          <span>Entity</span>
          <span>Risk</span>
          <span style={{ textAlign: "right" }}>Score</span>
        </div>

        {entities.length === 0 ? (
          <p className="text-[12px] text-slate-400 py-4">No entities yet.</p>
        ) : (
          entities.slice(0, 6).map((e, ix) => {
            const Ic = TYPE_ICON[e.entity_type] || Globe;
            const c = riskColors(e.risk_level || "");
            const isLast = ix === Math.min(entities.length, 6) - 1;
            return (
              <div
                key={e.id}
                className="grid items-center text-[12px]"
                style={{
                  gridTemplateColumns: "70px 1fr 70px 60px",
                  gap: 10,
                  padding: "12px 0",
                  borderBottom: isLast ? "none" : "1px solid #f1f5f9",
                }}
              >
                <span className="inline-flex items-center gap-1.5 text-slate-500 text-[11px]">
                  <Ic size={13} strokeWidth={1.6} />
                  {e.entity_type}
                </span>
                <span
                  className="text-deep-navy truncate"
                  title={e.normalized_value}
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 11.5,
                  }}
                >
                  {e.normalized_value}
                </span>
                <span
                  className="justify-self-start"
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: c.fg,
                    background: c.bg,
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {(e.risk_level || "—").toLowerCase()}
                </span>
                <span
                  className="text-deep-navy"
                  style={{
                    textAlign: "right",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontWeight: 500,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {e.risk_score ?? "—"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
