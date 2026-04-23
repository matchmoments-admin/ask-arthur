// Coverage chips — one small pill per provider showing live/pending/
// degraded/disabled. Surfaced prominently so the user understands why
// their report is narrower than a peer's (e.g., "SIM-swap coverage
// pending for your carrier" when Vonage CAMARA isn't granted yet).
//
// The pillar-to-provider mapping is asymmetric — one provider can feed
// multiple pillars (Vonage: reputation + sim_swap) — so we show raw
// provider coverage rather than per-pillar coverage. Less noisy for the
// user and truthful about what we called.

import type { Coverage } from "@askarthur/scam-engine/phone-footprint";

type Status = "live" | "pending" | "degraded" | "disabled" | "fallback";

const STATUS_STYLE: Record<Status, { fg: string; bg: string; label: string }> = {
  live: { fg: "#15803D", bg: "#ECFDF5", label: "Live" },
  pending: { fg: "#B45309", bg: "#FEF3C7", label: "Pending" },
  degraded: { fg: "#9A3412", bg: "#FFF3E0", label: "Degraded" },
  disabled: { fg: "#6B7280", bg: "#F3F4F6", label: "Off" },
  fallback: { fg: "#1D4ED8", bg: "#EFF6FF", label: "Fallback" },
};

const PROVIDER_LABELS: Record<keyof Coverage, string> = {
  internal: "Ask Arthur scam database",
  twilio: "Twilio carrier + line type",
  ipqs: "IPQS reputation",
  vonage: "Vonage fraud score & SIM swap",
  leakcheck: "LeakCheck phone-breach",
};

function chipStyle(status: Status) {
  return STATUS_STYLE[status] ?? STATUS_STYLE.disabled;
}

export function CoverageChips({ coverage }: { coverage: Coverage }) {
  const rows = (Object.keys(PROVIDER_LABELS) as Array<keyof Coverage>).map(
    (k) => ({
      key: k,
      label: PROVIDER_LABELS[k],
      status: (coverage[k] ?? "disabled") as Status,
    }),
  );

  return (
    <div className="flex flex-wrap gap-2" aria-label="Data source coverage">
      {rows.map(({ key, label, status }) => {
        const style = chipStyle(status);
        return (
          <span
            key={key}
            className="inline-flex items-center gap-2 rounded-full border border-transparent px-3 py-1 text-xs font-medium"
            style={{ color: style.fg, backgroundColor: style.bg }}
            title={`${label}: ${style.label}`}
          >
            <span>{label}</span>
            <span className="rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase">
              {style.label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
