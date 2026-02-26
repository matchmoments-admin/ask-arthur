"use client";

import { useEffect, useRef, useState } from "react";
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

const VERDICT_CONFIG = {
  SAFE: {
    icon: "verified_user",
    iconColor: "text-[#388E3C]",
    iconBg: "bg-safe-bg",
    title: "This Appears Safe",
  },
  SUSPICIOUS: {
    icon: "warning",
    iconColor: "text-[#F57C00]",
    iconBg: "bg-warn-bg",
    title: "Proceed with Caution",
  },
  HIGH_RISK: {
    icon: "gpp_bad",
    iconColor: "text-[#D32F2F]",
    iconBg: "bg-danger-bg",
    title: "High Risk — Likely a Scam",
  },
} as const;

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
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="relative flex items-center justify-center px-4 pt-safe-top h-14 shrink-0 border-b border-slate-200">
        <button
          type="button"
          onClick={onGoBack}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-gov-slate hover:text-deep-navy hover:bg-slate-100 transition-colors"
          aria-label="Go back"
        >
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <h2 className="text-deep-navy font-semibold text-base">QR Code Check</h2>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-5 py-8">
          {/* Analyzing state */}
          {step === "analyzing" && (
            <div className="flex flex-col items-center gap-6 pt-12">
              <div className="w-12 h-12 border-3 border-deep-navy border-t-transparent rounded-full animate-spin" />
              <div className="text-center space-y-3">
                {ANALYSIS_STEPS.map((label, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 transition-opacity duration-300 ${
                      i <= analysisStep ? "opacity-100" : "opacity-30"
                    }`}
                  >
                    <span className="material-symbols-outlined text-lg text-action-teal">
                      {i < analysisStep ? "check_circle" : i === analysisStep ? "pending" : "radio_button_unchecked"}
                    </span>
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
            <div className="flex flex-col items-center gap-6 pt-12">
              <div className="w-16 h-16 rounded-full bg-danger-bg flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl text-[#D32F2F]">error</span>
              </div>
              <p className="text-deep-navy text-base text-center">{errorMsg}</p>
              <div className="flex flex-col gap-3 w-full max-w-xs">
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
      </div>
    </div>
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
    <div className="flex flex-col items-center gap-5">
      {/* Verdict icon */}
      <div
        className={`w-20 h-20 rounded-full ${config.iconBg} flex items-center justify-center animate-verdict-icon`}
      >
        <span className={`material-symbols-outlined text-5xl ${config.iconColor}`}>
          {config.icon}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-xl font-bold text-deep-navy animate-verdict-content">
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
        <div className="animate-verdict-content flex flex-col gap-3 w-full max-w-xs mt-2">
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
                  <span className="material-symbols-outlined text-lg">open_in_new</span>
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
        <div className="animate-verdict-content flex flex-col gap-3 w-full max-w-xs mt-2">
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
              <span className="material-symbols-outlined text-lg">open_in_new</span>
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
        <div className="animate-verdict-content flex flex-col gap-3 w-full max-w-xs mt-2">
          {officialBrand && (
            <a
              href={officialBrand.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 px-6 bg-[#388E3C] text-white font-bold uppercase tracking-widest rounded-full hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">verified</span>
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
