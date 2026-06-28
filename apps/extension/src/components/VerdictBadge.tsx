import type { Verdict } from "@askarthur/types";
import type { LucideIcon } from "lucide-react";
import { Eye, TriangleAlert, ShieldAlert } from "lucide-react";

// "Never reassure": SAFE renders in the amber warn palette with a neutral Eye
// icon (not a green shield-check) — the lightest tier still nudges the user to
// stay alert (mirrors web ResultCard). Note: this recolours the SAFE *verdict*
// only; the shared `bg-safe`/`text-safe` design token is left untouched because
// it is reused by non-verdict UI (Protect/More/Security tabs).
const VERDICT_CONFIG: Record<Verdict, { bg: string; textColor: string; title: string; icon: LucideIcon }> = {
  SAFE: {
    bg: "bg-warn",
    textColor: "text-warn",
    title: "Stay alert",
    icon: Eye,
  },
  SUSPICIOUS: {
    bg: "bg-warn",
    textColor: "text-warn",
    title: "Suspicious",
    icon: TriangleAlert,
  },
  HIGH_RISK: {
    bg: "bg-danger",
    textColor: "text-danger",
    title: "Looks like a scam",
    icon: ShieldAlert,
  },
  UNCERTAIN: {
    bg: "bg-text-secondary",
    textColor: "text-text-secondary",
    title: "Uncertain",
    icon: TriangleAlert,
  },
};

export { VERDICT_CONFIG };

/** Colored header bar matching web app ResultCard */
export function VerdictHeader({ verdict }: { verdict: Verdict }) {
  const config = VERDICT_CONFIG[verdict];
  return (
    <div className={`${config.bg} px-4 py-3 flex items-center gap-2 rounded-t-[10px]`}>
      <config.icon size={20} className="text-white" />
      <h2 className="text-sm font-semibold text-white">
        {config.title}
      </h2>
    </div>
  );
}
