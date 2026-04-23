// Pillar grid — one card per pillar, showing availability + score + a
// contextual one-liner. When the footprint.tier === 'teaser', pillar
// scores are flattened to triggered/not-triggered (see scorer.redactForFree),
// so we show "Signal detected" / "No signal" copy instead of raw numbers.

import type {
  Footprint,
  PillarId,
  PillarResult,
} from "@askarthur/scam-engine/phone-footprint";

const PILLAR_LABELS: Record<PillarId, { title: string; blurb: string }> = {
  scam_reports: {
    title: "Community scam reports",
    blurb: "How often this number appears in Ask Arthur's first-party scam corpus.",
  },
  breach: {
    title: "Breach exposure",
    blurb: "Whether this number shows up in known data breaches.",
  },
  reputation: {
    title: "Live fraud reputation",
    blurb: "Carrier-aware fraud score from Vonage / IPQS.",
  },
  sim_swap: {
    title: "Recent SIM swap",
    blurb: "Has the SIM or device associated with this number changed recently?",
  },
  identity: {
    title: "Number identity",
    blurb: "Line type, carrier, and caller-name attributes.",
  },
};

function pillarCopy(
  tier: Footprint["tier"],
  pillar: PillarResult,
): { verdict: string; tone: "positive" | "neutral" | "warning" | "critical" } {
  if (!pillar.available) {
    return { verdict: "Coverage not available", tone: "neutral" };
  }
  if (tier === "teaser") {
    return pillar.score > 0
      ? { verdict: "Signal detected — unlock for detail", tone: "warning" }
      : { verdict: "No signal", tone: "positive" };
  }
  if (pillar.score >= 75) return { verdict: "Strong risk indicator", tone: "critical" };
  if (pillar.score >= 50) return { verdict: "Elevated risk", tone: "warning" };
  if (pillar.score >= 25) return { verdict: "Some signal", tone: "warning" };
  return { verdict: "Clean", tone: "positive" };
}

const TONE_STYLE: Record<
  "positive" | "neutral" | "warning" | "critical",
  { fg: string; bg: string }
> = {
  positive: { fg: "#15803D", bg: "#ECFDF5" },
  neutral: { fg: "#6B7280", bg: "#F3F4F6" },
  warning: { fg: "#B45309", bg: "#FFF8E1" },
  critical: { fg: "#B91C1C", bg: "#FEF2F2" },
};

export function PillarGrid({ footprint }: { footprint: Footprint }) {
  const order: PillarId[] = [
    "scam_reports",
    "breach",
    "reputation",
    "sim_swap",
    "identity",
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {order.map((id) => {
        const p = footprint.pillars[id];
        const meta = PILLAR_LABELS[id];
        const copy = pillarCopy(footprint.tier, p);
        const style = TONE_STYLE[copy.tone];
        return (
          <div
            key={id}
            className="rounded-xl border border-gray-200 p-4"
            style={{ backgroundColor: p.available ? "white" : "#FAFAFA" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{meta.title}</div>
                <p className="mt-1 text-xs text-gray-600">{meta.blurb}</p>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase"
                style={{ color: style.fg, backgroundColor: style.bg }}
              >
                {copy.verdict}
              </span>
            </div>
            {footprint.tier !== "teaser" && p.available && (
              <div className="mt-3 flex items-baseline gap-1 text-sm text-gray-500">
                <span className="tabular-nums font-semibold text-gray-900">{p.score}</span>
                <span>/ 100</span>
                <span className="ml-3 text-xs">
                  Confidence {Math.round(p.confidence * 100)}%
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
