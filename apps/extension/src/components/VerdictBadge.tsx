import type { Verdict } from "@askarthur/types";

const verdictConfig: Record<
  Verdict,
  { label: string; bg: string; border: string; text: string }
> = {
  SAFE: {
    label: "Safe",
    bg: "bg-safe-bg",
    border: "border-safe-border",
    text: "text-safe-heading",
  },
  SUSPICIOUS: {
    label: "Suspicious",
    bg: "bg-warn-bg",
    border: "border-warn-border",
    text: "text-warn-heading",
  },
  HIGH_RISK: {
    label: "High Risk",
    bg: "bg-danger-bg",
    border: "border-danger-border",
    text: "text-danger-heading",
  },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const config = verdictConfig[verdict];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${config.bg} ${config.border} ${config.text}`}
    >
      {config.label}
    </span>
  );
}
