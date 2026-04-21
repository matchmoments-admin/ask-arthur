"use client";

import type { LucideIcon } from "lucide-react";
import { ShieldCheck, TriangleAlert, ShieldAlert, Gauge, Flag } from "lucide-react";

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.85) return "High confidence";
  if (confidence >= 0.6) return "Moderate confidence";
  return "Low confidence";
}
import { useRef } from "react";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { getRecoverySteps } from "@/lib/recoverySteps";
import DeepfakeGauge from "./DeepfakeGauge";
import RecoveryGuide from "./RecoveryGuide";
import ScamReportCard from "./ScamReportCard";
import ResultFeedback from "./result/ResultFeedback";
import ResultActionButtons from "./result/ResultActionButtons";
import type { ScammerContacts } from "@askarthur/types";

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
  scamType?: string;
  impersonatedBrand?: string;
  // ScamReportCard props (passed through)
  scammerContacts?: ScammerContacts;
  scammerUrls?: Array<{ url: string; isMalicious: boolean; sources: string[] }>;
  channel?: string;
  inputMode?: string;
  // Result Screen V2 additions (gated by featureFlags.resultScreenV2)
  onCheckAnother?: () => void;
  contentHash?: string;
  analysisId?: string;
  scamReportId?: number;
}

const VERDICT_CONFIG: Record<Verdict, { color: string; bg: string; textColor: string; title: string; icon: LucideIcon }> = {
  SAFE: {
    color: "#388E3C",
    bg: "bg-[#388E3C]",
    textColor: "text-[#388E3C]",
    title: "This Appears Safe",
    icon: ShieldCheck,
  },
  SUSPICIOUS: {
    color: "#F57C00",
    bg: "bg-[#F57C00]",
    textColor: "text-[#F57C00]",
    title: "Proceed with Caution",
    icon: TriangleAlert,
  },
  HIGH_RISK: {
    color: "#D32F2F",
    bg: "bg-[#D32F2F]",
    textColor: "text-[#D32F2F]",
    title: "High Risk — Likely a Scam",
    icon: ShieldAlert,
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
  scamType,
  impersonatedBrand,
  scammerContacts,
  scammerUrls,
  channel,
  inputMode,
  onCheckAnother,
  contentHash,
  analysisId,
  scamReportId,
}: ResultCardProps) {
  const config = VERDICT_CONFIG[verdict];
  const recovery = getRecoverySteps(scamType, impersonatedBrand, verdict);
  const scamReportRef = useRef<HTMLDivElement | null>(null);
  const scamwatchRef = useRef<HTMLDivElement | null>(null);

  const scamReportCardVisible = Boolean(
    featureFlags.scamContactReporting && (scammerContacts || scammerUrls),
  );
  const scamwatchCtaVisible = verdict === "HIGH_RISK" && countryCode === "AU";
  const hasReportSurface = scamReportCardVisible || scamwatchCtaVisible;

  function handleReport() {
    const target = scamReportRef.current ?? scamwatchRef.current;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Fallback: open Scamwatch portal in a new tab.
    if (typeof window !== "undefined") {
      window.open(
        "https://portal.scamwatch.gov.au/report-a-scam/",
        "_blank",
        "noopener,noreferrer",
      );
    }
  }

  return (
    <div role="alert" className="mt-6 rounded-sm border border-slate-200 overflow-hidden">
      {/* Colored header bar */}
      <div className={`${config.bg} px-6 py-4 flex items-center gap-3`}>
        <config.icon className="text-white" size={24} />
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
          <Gauge size={18} />
          <span className="text-sm font-bold uppercase tracking-widest">
            {getConfidenceLabel(confidence)}
          </span>
        </div>

        {/* Phase 2: Deepfake gauge (gated by feature flag) */}
        {featureFlags.deepfakeDetection && deepfakeScore != null && deepfakeProvider && (
          <div className="mb-5">
            <DeepfakeGauge score={deepfakeScore} provider={deepfakeProvider} />
          </div>
        )}

        {/* Scam Report Card — help protect others */}
        {scamReportCardVisible && (
          <div className="mb-5" ref={scamReportRef}>
            <ScamReportCard
              contacts={scammerContacts}
              scammerUrls={scammerUrls}
              scamType={scamType}
              brandImpersonated={impersonatedBrand}
              channel={channel}
              sourceType={inputMode}
            />
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

        {/* Brand verification prompt */}
        {verdict !== "SAFE" && impersonatedBrand && (
          <div className="mt-5 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-amber-900 text-sm font-semibold mb-1">
              If you use {impersonatedBrand}:
            </p>
            <p className="text-amber-900 text-sm leading-relaxed">
              Check the official app or website directly, review your recent activity,
              and contact {impersonatedBrand} using the number or address on their
              official site — not anything in this message.
            </p>
          </div>
        )}
        {verdict !== "SAFE" && !impersonatedBrand && (
          <p className="text-sm text-gov-slate mt-3 leading-relaxed">
            If this message mentions a service you actually use — bank, telco,
            delivery, or government — check that service&apos;s official app or website
            directly and review your recent activity before dismissing it.
          </p>
        )}

        {/* Recovery guidance for HIGH_RISK / SUSPICIOUS (feature-gated) */}
        {featureFlags.recoveryGuidance && recovery && (verdict === "HIGH_RISK" || verdict === "SUSPICIOUS") && (
          <RecoveryGuide recovery={recovery} verdict={verdict} />
        )}

        {/* Scamwatch reporting CTA for Australian users on HIGH_RISK */}
        {scamwatchCtaVisible && (
          <div ref={scamwatchRef} className="mt-5 p-4 bg-danger-bg border border-danger-border rounded-lg">
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
              <Flag size={18} />
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

        {/* Result Screen V2: thumbs feedback + two-button footer. Gated off
            by default — safe to ship ahead of v66 DB migration application. */}
        {featureFlags.resultScreenV2 && (
          <>
            <ResultFeedback
              verdictGiven={verdict}
              analysisId={analysisId}
              scamReportId={scamReportId}
              contentHash={contentHash}
            />
            {onCheckAnother && (
              <ResultActionButtons
                onCheckAnother={onCheckAnother}
                onReport={verdict === "SAFE" ? undefined : handleReport}
                showReport={verdict !== "SAFE" && hasReportSurface}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

