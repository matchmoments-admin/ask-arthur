interface StatChipProps {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
  big?: boolean;
}

/**
 * Horizontal-scrolling stat chip used in the triage header strip.
 * `big` doubles the prominence for the first two chips (Awaiting / 7d).
 */
export default function StatChip({ label, value, tone = "neutral", big }: StatChipProps) {
  const isWarn = tone === "warn";
  return (
    <div
      className="flex flex-col gap-1 shrink-0"
      style={{
        minWidth: big ? 148 : 116,
        background: isWarn ? "#FFF7E6" : "var(--color-surface)",
        border: `1px solid ${isWarn ? "#F3DE92" : "var(--color-line)"}`,
        borderRadius: 12,
        padding: "10px 12px",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <span
        className="uppercase"
        style={{
          fontSize: 10.5,
          letterSpacing: "0.08em",
          color: "var(--color-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        className="serif leading-none"
        style={{
          fontSize: big ? 24 : 20,
          color: isWarn ? "#B45309" : "var(--color-ink)",
        }}
      >
        {value}
      </span>
    </div>
  );
}
