import type { ExtensionRiskLevel } from "@askarthur/types";

const BADGE_CONFIG: Record<
  ExtensionRiskLevel,
  { bg: string; text: string; label: string; pulse?: boolean }
> = {
  LOW: { bg: "bg-green-100", text: "text-green-800", label: "Low Risk" },
  MEDIUM: { bg: "bg-amber-100", text: "text-amber-800", label: "Medium Risk" },
  HIGH: { bg: "bg-red-100", text: "text-red-800", label: "High Risk" },
  CRITICAL: {
    bg: "bg-red-200",
    text: "text-red-900",
    label: "Critical",
    pulse: true,
  },
};

export function ExtensionRiskBadge({ level }: { level: ExtensionRiskLevel }) {
  const config = BADGE_CONFIG[level];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${config.bg} ${config.text} ${
        config.pulse ? "animate-pulse" : ""
      }`}
    >
      {config.label}
    </span>
  );
}
