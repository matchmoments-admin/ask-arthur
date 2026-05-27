/**
 * Threshold-tinted score badge. Replicates the design's severity ramp:
 *   ≥0.90 — red (--color-tp-*)
 *   ≥0.83 — amber (--color-inv-*)
 *   <0.83 — slate (--color-ink-2)
 *
 * The threshold-tinted background is the one legitimate inline-style
 * case in this component family — Tailwind can't model arbitrary
 * value→class without a generated class table.
 */
interface ScoreBadgeProps {
  value: number;
}

export default function ScoreBadge({ value }: ScoreBadgeProps) {
  const high = value >= 0.9;
  const mid = !high && value >= 0.83;
  const fg = high ? "var(--color-tp-fg)" : mid ? "#B45309" : "var(--color-ink-2)";
  const bg = high ? "var(--color-tp-bg)" : mid ? "#FFF1D9" : "#EEF2F8";
  return (
    <span
      className="inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
      style={{
        padding: "3px 9px 3px 8px",
        background: bg,
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 600,
        color: fg,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: fg,
          opacity: 0.85,
          display: "inline-block",
        }}
      />
      score {value.toFixed(2)}
    </span>
  );
}
