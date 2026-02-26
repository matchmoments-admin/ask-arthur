import type { Verdict } from "@askarthur/types";

const VERDICT_CONFIG = {
  SAFE: {
    bg: "bg-[#388E3C]",
    textColor: "text-[#388E3C]",
    title: "This Appears Safe",
    icon: "verified_user",
  },
  SUSPICIOUS: {
    bg: "bg-[#F57C00]",
    textColor: "text-[#F57C00]",
    title: "Proceed with Caution",
    icon: "warning",
  },
  HIGH_RISK: {
    bg: "bg-[#D32F2F]",
    textColor: "text-[#D32F2F]",
    title: "High Risk — Likely a Scam",
    icon: "gpp_bad",
  },
};

export { VERDICT_CONFIG };

/** Colored header bar matching web app ResultCard */
export function VerdictHeader({ verdict }: { verdict: Verdict }) {
  const config = VERDICT_CONFIG[verdict];
  return (
    <div className={`${config.bg} px-4 py-3 flex items-center gap-2 rounded-t-xl`}>
      <span className="material-symbols-outlined text-white text-xl">{config.icon}</span>
      <h2 className="text-sm font-semibold text-white">
        {config.title}
      </h2>
    </div>
  );
}
