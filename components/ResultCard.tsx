"use client";

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface ResultCardProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
}

const VERDICT_CONFIG = {
  SAFE: {
    color: "#388E3C",
    bg: "bg-[#388E3C]",
    textColor: "text-[#388E3C]",
    title: "This Appears Safe",
    icon: "verified_user",
  },
  SUSPICIOUS: {
    color: "#F57C00",
    bg: "bg-[#F57C00]",
    textColor: "text-[#F57C00]",
    title: "Proceed with Caution",
    icon: "warning",
  },
  HIGH_RISK: {
    color: "#D32F2F",
    bg: "bg-[#D32F2F]",
    textColor: "text-[#D32F2F]",
    title: "High Risk — Likely a Scam",
    icon: "gpp_bad",
  },
};

export default function ResultCard({
  verdict,
  confidence,
  summary,
  redFlags,
  nextSteps,
}: ResultCardProps) {
  const config = VERDICT_CONFIG[verdict];

  return (
    <div role="alert" className="mt-6 rounded-sm border border-slate-200 overflow-hidden">
      {/* Colored header bar */}
      <div className={`${config.bg} px-6 py-4 flex items-center gap-3`}>
        <span className="material-symbols-outlined text-white text-2xl">{config.icon}</span>
        <h2 className="text-lg font-bold text-white">
          {config.title}
        </h2>
      </div>

      {/* Body */}
      <div className="bg-white px-6 py-5">
        {/* Summary */}
        <p className="text-deep-navy text-base leading-relaxed mb-4">{summary}</p>

        {/* Confidence */}
        <div className={`flex items-center gap-2 mb-5 ${config.textColor}`}>
          <span className="material-symbols-outlined text-lg">speed</span>
          <span className="text-sm font-bold uppercase tracking-widest">
            {Math.round(confidence * 100)}% confidence
          </span>
        </div>

        {/* Red Flags */}
        {redFlags.length > 0 && (
          <div className="mb-5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-deep-navy mb-3">
              What We Found
            </h3>
            <ul className="space-y-2">
              {redFlags.map((flag, i) => (
                <li key={i} className="flex items-start gap-2 text-gov-slate text-base leading-relaxed">
                  <span
                    className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: config.color }}
                  />
                  {flag}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Next Steps */}
        {nextSteps.length > 0 && (
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-deep-navy mb-3">
              What To Do
            </h3>
            <ol className="space-y-2 list-decimal list-inside">
              {nextSteps.map((step, i) => (
                <li key={i} className="text-gov-slate text-base leading-relaxed">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
