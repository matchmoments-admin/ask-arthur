import Link from "next/link";
import { Shield, Eye, FileText, Zap, Activity, Lock } from "lucide-react";
import type { SpfPrinciple } from "@/lib/dashboard";

const ICONS: Record<SpfPrinciple["key"], typeof Shield> = {
  prevent: Shield,
  detect: Eye,
  report: FileText,
  disrupt: Zap,
  respond: Activity,
  govern: Lock,
};

const STATUS_DOT: Record<SpfPrinciple["status"], string> = {
  met: "#16a34a",
  partial: "#f59e0b",
  missed: "#dc2626",
};

interface SafeSpfPostureProps {
  principles: SpfPrinciple[];
  overallPct: number;
  primary?: string;
}

export default function SafeSpfPosture({
  principles,
  overallPct,
  primary = "var(--color-deep-navy)",
}: SafeSpfPostureProps) {
  const ringR = 40;
  const ringC = 2 * Math.PI * ringR;

  const metCount = principles.filter((p) => p.status === "met").length;
  const partialCount = principles.filter((p) => p.status === "partial").length;

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
            SPF posture
          </h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Scams Prevention Framework
          </p>
        </div>
        <Link
          href="/app/spf-compliance"
          className="text-[12px] font-medium text-deep-navy hover:underline"
        >
          View ↗
        </Link>
      </header>

      <div style={{ padding: "0 22px 14px" }} className="flex items-center gap-4">
        <div style={{ position: "relative", width: 96, height: 96 }}>
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle
              cx="48"
              cy="48"
              r={ringR}
              fill="none"
              stroke="#f1f5f9"
              strokeWidth="8"
            />
            <circle
              cx="48"
              cy="48"
              r={ringR}
              fill="none"
              stroke={primary}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${overallPct * ringC} ${ringC}`}
              transform="rotate(-90 48 48)"
            />
          </svg>
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              color: "var(--color-deep-navy)",
            }}
          >
            {Math.round(overallPct * 100)}%
          </div>
        </div>
        <div className="text-[12px] text-slate-500 leading-relaxed">
          <div className="text-emerald-600 font-medium mb-1">
            {metCount} of {principles.length} obligations fully met
          </div>
          <div>
            {partialCount} partial — track progress on the SPF compliance page.
          </div>
        </div>
      </div>

      <div
        style={{ padding: "0 22px 22px" }}
        className="grid grid-cols-3 gap-2"
      >
        {principles.map((p) => {
          const Ic = ICONS[p.key];
          return (
            <div
              key={p.key}
              style={{
                background: "#f8fafc",
                borderRadius: 7,
                padding: "8px 10px",
              }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-deep-navy">
                <Ic
                  size={12}
                  strokeWidth={1.7}
                  style={{ color: "var(--color-deep-navy)" }}
                />
                <span>{p.label}</span>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: STATUS_DOT[p.status],
                    marginLeft: "auto",
                  }}
                  aria-hidden
                />
              </div>
              <div
                className="text-deep-navy"
                style={{
                  fontSize: 14,
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  marginTop: 4,
                  fontWeight: 500,
                }}
              >
                {Math.round(p.pct * 100)}%
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
