// Band badge — the top-of-report "safe / caution / high / critical" chip plus
// the composite 0-100 score. Colour tokens align with PhoneIntelCard's
// RISK_COLORS so visual language is consistent across the product.

type Band = "safe" | "caution" | "high" | "critical";

const BAND_COLORS: Record<Band, { fg: string; bg: string; label: string }> = {
  safe: { fg: "#15803D", bg: "#ECFDF5", label: "Safe" },
  caution: { fg: "#B45309", bg: "#FFF8E1", label: "Caution" },
  high: { fg: "#C2410C", bg: "#FFF3E0", label: "High risk" },
  critical: { fg: "#B91C1C", bg: "#FEF2F2", label: "Critical" },
};

interface Props {
  score: number;
  band: Band;
  /** When true, render a smaller inline pill instead of the hero block. */
  compact?: boolean;
}

export function BandBadge({ score, band, compact = false }: Props) {
  const theme = BAND_COLORS[band];

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium"
        style={{ color: theme.fg, backgroundColor: theme.bg }}
      >
        <span className="text-xs font-bold tracking-wider uppercase">{theme.label}</span>
        <span className="tabular-nums">{score}/100</span>
      </span>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-2 rounded-2xl px-6 py-5"
      style={{ backgroundColor: theme.bg }}
    >
      <div className="text-xs font-bold tracking-widest uppercase" style={{ color: theme.fg }}>
        {theme.label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-bold tabular-nums" style={{ color: theme.fg }}>
          {score}
        </span>
        <span className="text-xl font-medium" style={{ color: theme.fg }}>
          / 100
        </span>
      </div>
    </div>
  );
}
