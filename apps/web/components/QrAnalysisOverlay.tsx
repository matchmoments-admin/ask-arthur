"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ShieldCheck, TriangleAlert, ShieldAlert, CheckCircle, Clock, Circle, CircleAlert, ExternalLink, BadgeCheck } from "lucide-react";
import { Drawer } from "vaul";
import type { AnalysisResponse } from "@/types/analysis";
import { getOfficialBrand } from "@/lib/officialBrands";

interface QrAnalysisOverlayProps {
  step: "analyzing" | "verdict" | "error";
  scannedUrl: string | null;
  result: AnalysisResponse | null;
  errorMsg: string | null;
  onGoBack: () => void;
  onScanAnother: () => void;
}

const VERDICT_CONFIG: Record<string, { icon: LucideIcon; iconColor: string; iconBg: string; title: string }> = {
  SAFE: {
    icon: ShieldCheck,
    iconColor: "text-[#388E3C]",
    iconBg: "bg-safe-bg",
    title: "This Appears Safe",
  },
  SUSPICIOUS: {
    icon: TriangleAlert,
    iconColor: "text-[#F57C00]",
    iconBg: "bg-warn-bg",
    title: "Proceed with Caution",
  },
  HIGH_RISK: {
    icon: ShieldAlert,
    iconColor: "text-[#D32F2F]",
    iconBg: "bg-danger-bg",
    title: "High Risk — Likely a Scam",
  },
};

const ANALYSIS_STEPS = [
  "Decoding QR content...",
  "Checking URL reputation...",
  "Analyzing with AI...",
];

export default function QrAnalysisOverlay({
  step,
  scannedUrl,
  result,
  errorMsg,
  onGoBack,
  onScanAnother,
}: QrAnalysisOverlayProps) {
  const [autoOpenCountdown, setAutoOpenCountdown] = useState<number | null>(null);
  const [autoOpenCancelled, setAutoOpenCancelled] = useState(false);
  const autoOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [analysisStep, setAnalysisStep] = useState(0);

  const isHighRisk = step === "verdict" && result?.verdict === "HIGH_RISK";

  // Animate through analysis steps
  useEffect(() => {
    if (step !== "analyzing") return;
    setAnalysisStep(0);
    const interval = setInterval(() => {
      setAnalysisStep((prev) => (prev < ANALYSIS_STEPS.length - 1 ? prev + 1 : prev));
    }, 1200);
    return () => clearInterval(interval);
  }, [step]);

  // Auto-open timer for SAFE verdict with a URL
  useEffect(() => {
    if (
      step !== "verdict" ||
      !result ||
      result.verdict !== "SAFE" ||
      !scannedUrl ||
      autoOpenCancelled
    ) {
      return;
    }

    setAutoOpenCountdown(3);

    countdownRef.current = setInterval(() => {
      setAutoOpenCountdown((prev) => {
        if (prev === null || prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);

    autoOpenTimerRef.current = setTimeout(() => {
      window.open(scannedUrl, "_blank", "noopener,noreferrer");
    }, 3000);

    return () => {
      if (autoOpenTimerRef.current) clearTimeout(autoOpenTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [step, result, scannedUrl, autoOpenCancelled]);

  function cancelAutoOpen() {
    setAutoOpenCancelled(true);
    setAutoOpenCountdown(null);
    if (autoOpenTimerRef.current) {
      clearTimeout(autoOpenTimerRef.current);
      autoOpenTimerRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }

  return (
    <Drawer.Root
      open={true}
      modal={false}
      dismissible={!isHighRisk}
      onClose={onGoBack}
    >
      <Drawer.Portal>
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-[60] rounded-t-2xl bg-white max-h-[85vh] flex flex-col focus:outline-none"
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-2 shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300" />
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-5 pb-safe-bottom">
            {/* Analyzing state */}
            {step === "analyzing" && (
              <div className="flex flex-col items-center gap-4 pb-6">
                <div className="w-10 h-10 border-3 border-deep-navy border-t-transparent rounded-full animate-spin" />
                <div className="text-center space-y-3">
                  {ANALYSIS_STEPS.map((label, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2.5 transition-opacity duration-300 ${
                        i <= analysisStep ? "opacity-100" : "opacity-30"
                      }`}
                    >
                      {i < analysisStep ? (
                        <CheckCircle className="text-action-teal" size={18} />
                      ) : i === analysisStep ? (
                        <Clock className="text-action-teal" size={18} />
                      ) : (
                        <Circle className="text-action-teal" size={18} />
                      )}
                      <span className="text-gov-slate text-base">{label}</span>
                    </div>
                  ))}
                </div>
                {scannedUrl && (
                  <p className="text-sm text-slate-400 text-center break-all max-w-xs mt-2">
                    {scannedUrl}
                  </p>
                )}
              </div>
            )}

            {/* Error state */}
            {step === "error" && (
              <div className="flex flex-col items-center gap-4 pb-6">
                <div className="w-12 h-12 rounded-full bg-danger-bg flex items-center justify-center">
                  <CircleAlert className="text-[#D32F2F]" size={24} />
                </div>
                <p className="text-deep-navy text-base text-center">{errorMsg}</p>
                <div className="flex flex-col gap-3 w-full">
                  <button
                    type="button"
                    onClick={onGoBack}
                    className="h-12 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={onScanAnother}
                    className="h-12 px-6 text-gov-slate font-bold uppercase tracking-widest rounded-full border-2 border-slate-200 hover:bg-slate-50 transition-colors text-sm"
                  >
                    Scan Another
                  </button>
                </div>
              </div>
            )}

            {/* Verdict state */}
            {step === "verdict" && result && (
              <VerdictContent
                result={result}
                scannedUrl={scannedUrl}
                autoOpenCountdown={autoOpenCountdown}
                autoOpenCancelled={autoOpenCancelled}
                onCancelAutoOpen={cancelAutoOpen}
                onGoBack={onGoBack}
                onScanAnother={onScanAnother}
              />
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function VerdictContent({
  result,
  scannedUrl,
  autoOpenCountdown,
  autoOpenCancelled,
  onCancelAutoOpen,
  onGoBack,
  onScanAnother,
}: {
  result: AnalysisResponse;
  scannedUrl: string | null;
  autoOpenCountdown: number | null;
  autoOpenCancelled: boolean;
  onCancelAutoOpen: () => void;
  onGoBack: () => void;
  onScanAnother: () => void;
}) {
  const config = VERDICT_CONFIG[result.verdict];
  const officialBrand = result.impersonatedBrand
    ? getOfficialBrand(result.impersonatedBrand)
    : null;

  return (
    <div className="flex flex-col items-center gap-3 pb-6">
      {/* Verdict icon */}
      <div
        className={`w-14 h-14 rounded-full ${config.iconBg} flex items-center justify-center animate-verdict-icon`}
      >
        <config.icon className={config.iconColor} size={30} />
      </div>

      {/* Title */}
      <h3 className="text-lg font-bold text-deep-navy animate-verdict-content">
        {config.title}
      </h3>

      {/* Summary + confidence */}
      <div className="animate-verdict-content text-center space-y-2">
        <p className="text-gov-slate text-base leading-relaxed">{result.summary}</p>
        <p className={`text-sm font-bold uppercase tracking-widest ${config.iconColor}`}>
          {Math.round(result.confidence * 100)}% confidence
        </p>
      </div>

      {/* Red flags */}
      {result.redFlags.length > 0 && (
        <div className="animate-verdict-content w-full">
          <h4 className="text-xs font-bold uppercase tracking-widest text-deep-navy mb-2">
            What We Found
          </h4>
          <ul className="space-y-1.5">
            {result.redFlags.map((flag, i) => (
              <li key={i} className="flex items-start gap-2 text-gov-slate text-sm leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-slate-400" />
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SAFE verdict actions */}
      {result.verdict === "SAFE" && (
        <div className="animate-verdict-content flex flex-col gap-3 w-full mt-2">
          {scannedUrl && (
            <>
              {/* Auto-open notice or manual link */}
              {!autoOpenCancelled && autoOpenCountdown !== null && autoOpenCountdown > 0 ? (
                <p className="text-sm text-gov-slate text-center">
                  Opening link automatically...
                </p>
              ) : (
                <a
                  href={scannedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-12 px-6 bg-[#388E3C] text-white font-bold uppercase tracking-widest rounded-full hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2"
                >
                  <ExternalLink size={18} />
                  Visit Link
                </a>
              )}
              {!autoOpenCancelled && autoOpenCountdown !== null && autoOpenCountdown > 0 && (
                <button
                  type="button"
                  onClick={onCancelAutoOpen}
                  className="h-12 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
                >
                  Don&apos;t Open
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={onScanAnother}
            className="h-12 px-6 text-gov-slate font-bold uppercase tracking-widest rounded-full border-2 border-slate-200 hover:bg-slate-50 transition-colors text-sm"
          >
            Scan Another
          </button>
        </div>
      )}

      {/* SUSPICIOUS verdict actions */}
      {result.verdict === "SUSPICIOUS" && (
        <div className="animate-verdict-content flex flex-col gap-3 w-full mt-2">
          <button
            type="button"
            onClick={onGoBack}
            className="h-12 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
          >
            Go Back
          </button>
          {scannedUrl && (
            <a
              href={scannedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 px-6 text-gov-slate font-bold uppercase tracking-widest rounded-full border-2 border-slate-200 hover:bg-slate-50 transition-colors text-sm flex items-center justify-center gap-2"
            >
              <ExternalLink size={18} />
              Visit Anyway
            </a>
          )}
          <button
            type="button"
            onClick={onScanAnother}
            className="h-10 px-4 text-slate-400 font-semibold uppercase tracking-widest text-xs hover:text-gov-slate transition-colors"
          >
            Scan Another
          </button>
        </div>
      )}

      {/* HIGH_RISK verdict actions */}
      {result.verdict === "HIGH_RISK" && (
        <div className="animate-verdict-content flex flex-col gap-3 w-full mt-2">
          {officialBrand && (
            <a
              href={officialBrand.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 px-6 bg-[#388E3C] text-white font-bold uppercase tracking-widest rounded-full hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2"
            >
              <BadgeCheck size={18} />
              Visit the real {officialBrand.label}
            </a>
          )}
          <button
            type="button"
            onClick={onGoBack}
            className="h-12 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={onScanAnother}
            className="h-10 px-4 text-slate-400 font-semibold uppercase tracking-widest text-xs hover:text-gov-slate transition-colors"
          >
            Scan Another
          </button>
        </div>
      )}

      {/* AI disclaimer */}
      <p className="text-[11px] text-slate-400 text-center leading-relaxed mt-4 animate-verdict-content">
        This analysis is AI-generated and advisory only. Always exercise your own judgment.
      </p>
    </div>
  );
}
