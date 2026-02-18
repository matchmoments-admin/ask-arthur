"use client";

interface DeepfakeGaugeProps {
  score: number; // 0–1
  provider: string; // "reality_defender" | "resemble_ai"
}

const THRESHOLDS = {
  low: { max: 0.3, label: "Likely Authentic", color: "#388E3C", bg: "#ECFDF5" },
  medium: { max: 0.7, label: "Uncertain — Review Recommended", color: "#F57C00", bg: "#FFF8E1" },
  high: { max: 1.0, label: "Likely AI-Generated", color: "#D32F2F", bg: "#FEF2F2" },
};

export default function DeepfakeGauge({ score, provider }: DeepfakeGaugeProps) {
  const level =
    score <= 0.3
      ? THRESHOLDS.low
      : score <= 0.7
        ? THRESHOLDS.medium
        : THRESHOLDS.high;

  const percentage = Math.round(score * 100);

  const providerLabel =
    provider === "reality_defender" ? "Reality Defender" : "Resemble AI";

  return (
    <div className="rounded-sm border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-deep-navy">mic</span>
          <h4 className="text-xs font-bold uppercase tracking-widest text-deep-navy">
            Voice Authenticity Check
          </h4>
        </div>
      </div>
      <div className="px-4 py-4 bg-white">
        {/* Score bar */}
        <div className="w-full bg-gray-100 rounded-full h-3 mb-3">
          <div
            className="h-3 rounded-full transition-all duration-500"
            style={{ width: `${percentage}%`, backgroundColor: level.color }}
          />
        </div>
        {/* Label */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold" style={{ color: level.color }}>
            {level.label}
          </span>
          <span className="text-xs text-slate-400">
            {percentage}% AI probability
          </span>
        </div>
        {/* Provider attribution */}
        <p className="text-xs text-slate-300 mt-2">
          Checked by {providerLabel}
        </p>
      </div>
    </div>
  );
}
