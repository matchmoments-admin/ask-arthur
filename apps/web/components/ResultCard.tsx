"use client";

import { featureFlags } from "@/lib/featureFlags";
import DeepfakeGauge from "./DeepfakeGauge";

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface ResultCardProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
  // Phase 2 additions (optional — only present for media analyses)
  deepfakeScore?: number;
  deepfakeProvider?: string;
  phoneRiskFlags?: string[];
  isVoipCaller?: boolean;
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
  countryCode,
  deepfakeScore,
  deepfakeProvider,
  phoneRiskFlags,
  isVoipCaller,
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

        {/* Phase 2: Deepfake gauge (gated by feature flag) */}
        {featureFlags.deepfakeDetection && deepfakeScore != null && deepfakeProvider && (
          <div className="mb-5">
            <DeepfakeGauge score={deepfakeScore} provider={deepfakeProvider} />
          </div>
        )}

        {/* Phase 2: Phone intelligence (gated by feature flag) */}
        {featureFlags.phoneIntelligence && phoneRiskFlags && phoneRiskFlags.length > 0 && (
          <div className="mb-5 rounded-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg text-deep-navy">phone_in_talk</span>
                <h4 className="text-xs font-bold uppercase tracking-widest text-deep-navy">
                  Phone Number Intelligence
                </h4>
              </div>
            </div>
            <div className="px-4 py-4 bg-white">
              {isVoipCaller && (
                <div className="flex items-start gap-2 mb-2">
                  <span className="material-symbols-outlined text-sm text-[#F57C00] mt-0.5">warning</span>
                  <span className="text-sm text-gov-slate">
                    VoIP number detected — commonly used by scammers to mask their identity
                  </span>
                </div>
              )}
              <ul className="space-y-1">
                {phoneRiskFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gov-slate">
                    <span
                      className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-slate-400"
                    />
                    {formatRiskFlag(flag)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

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

        {/* Scamwatch reporting CTA for Australian users on HIGH_RISK */}
        {verdict === "HIGH_RISK" && countryCode === "AU" && (
          <div className="mt-5 p-4 bg-danger-bg border border-danger-border rounded-lg">
            <p className="text-deep-navy text-base font-bold mb-2">
              Report this scam to Scamwatch
            </p>
            <p className="text-gov-slate text-sm mb-3">
              Help protect other Australians by reporting this scam to the ACCC.
            </p>
            <a
              href="https://portal.scamwatch.gov.au/report-a-scam/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-11 px-5 bg-danger-text text-white font-bold text-sm uppercase tracking-widest rounded-full hover:opacity-90 transition-opacity"
            >
              <span className="material-symbols-outlined text-lg">flag</span>
              Report to Scamwatch
            </a>
          </div>
        )}

        {/* AI advisory disclaimer */}
        <div className="mt-5 pt-4 border-t border-slate-200">
          <p className="text-xs text-slate-400 leading-relaxed">
            This analysis is AI-generated and advisory only. Always exercise
            your own judgment.{" "}
            <a
              href="https://www.scamwatch.gov.au"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 underline hover:text-slate-500"
            >
              Report scams to Scamwatch
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}

function formatRiskFlag(flag: string): string {
  const labels: Record<string, string> = {
    voip: "VoIP number (internet-based, not tied to a physical line)",
    invalid_number: "Invalid phone number format",
    non_au_origin: "Number originates outside Australia",
    unknown_carrier: "Carrier information unavailable",
    lookup_failed: "Phone number lookup could not be completed",
  };
  return labels[flag] || flag;
}
