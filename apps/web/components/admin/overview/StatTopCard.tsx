/**
 * Compact stat card used at the top of the Overview screen. Renders a
 * dot-coded label, large serif value, and one-line caption.
 */
export type StatTone = "neutral" | "ok" | "attention" | "danger";

interface StatTopCardProps {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
}

const TONE_DOT: Record<StatTone, string> = {
  neutral: "var(--color-muted-2)",
  ok: "var(--color-teal)",
  attention: "#D97706",
  danger: "var(--color-tp-fg)",
};

export default function StatTopCard({ label, value, sub, tone = "neutral" }: StatTopCardProps) {
  return (
    <div
      className="flex flex-col gap-1.5"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: 14,
        padding: "12px 13px",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: TONE_DOT[tone],
            display: "inline-block",
          }}
        />
        <span
          className="text-[10.5px] font-semibold uppercase"
          style={{ letterSpacing: "0.08em", color: "var(--color-muted)" }}
        >
          {label}
        </span>
      </div>
      <div className="serif text-[24px] leading-none" style={{ color: "var(--color-ink)" }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11.5px]" style={{ color: "var(--color-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
