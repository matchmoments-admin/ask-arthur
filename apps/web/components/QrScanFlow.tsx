"use client";

import { useReducer, useCallback } from "react";
import QrScanner from "./QrScanner";
import QrAnalysisOverlay from "./QrAnalysisOverlay";
import type { AnalysisResponse } from "@/types/analysis";

interface QrScanFlowProps {
  open: boolean;
  onClose: () => void;
}

// --- State machine ---

type QrFlowState =
  | { step: "scanning" }
  | { step: "analyzing"; scannedText: string; scannedUrl: string | null }
  | { step: "verdict"; scannedText: string; scannedUrl: string | null; result: AnalysisResponse }
  | { step: "error"; scannedText: string; scannedUrl: string | null; errorMsg: string };

type QrFlowAction =
  | { type: "SCAN"; scannedText: string; scannedUrl: string | null }
  | { type: "RESULT"; result: AnalysisResponse }
  | { type: "ERROR"; errorMsg: string }
  | { type: "RESET" };

function reducer(_state: QrFlowState, action: QrFlowAction): QrFlowState {
  switch (action.type) {
    case "SCAN":
      return { step: "analyzing", scannedText: action.scannedText, scannedUrl: action.scannedUrl };
    case "RESULT":
      if (_state.step !== "analyzing") return _state;
      return { step: "verdict", scannedText: _state.scannedText, scannedUrl: _state.scannedUrl, result: action.result };
    case "ERROR":
      if (_state.step !== "analyzing") return _state;
      return { step: "error", scannedText: _state.scannedText, scannedUrl: _state.scannedUrl, errorMsg: action.errorMsg };
    case "RESET":
      return { step: "scanning" };
  }
}

const INITIAL_STATE: QrFlowState = { step: "scanning" };

export default function QrScanFlow({ open, onClose }: QrScanFlowProps) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const handleScan = useCallback(
    async (decodedText: string) => {
      const urlMatch = decodedText.match(/https?:\/\/\S+/);
      const scannedUrl = urlMatch ? urlMatch[0] : null;
      const textToAnalyze = scannedUrl ?? decodedText;

      dispatch({ type: "SCAN", scannedText: decodedText, scannedUrl });

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: textToAnalyze,
            mode: "qrcode",
          }),
        });

        if (res.status === 429) {
          const data = await res.json();
          dispatch({ type: "ERROR", errorMsg: data.message || "Too many requests. Please try again later." });
          return;
        }

        if (!res.ok) {
          throw new Error("Analysis failed");
        }

        const data: AnalysisResponse = await res.json();
        dispatch({ type: "RESULT", result: data });
        window.dispatchEvent(new Event("safeverify:check-complete"));
      } catch {
        dispatch({ type: "ERROR", errorMsg: "Something went wrong. Please try again." });
      }
    },
    []
  );

  const handleGoBack = useCallback(() => {
    dispatch({ type: "RESET" });
    onClose();
  }, [onClose]);

  const handleScanAnother = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  if (!open) return null;

  // Scanning phase — use existing QrScanner
  if (state.step === "scanning") {
    return (
      <QrScanner
        open={true}
        onClose={() => {
          dispatch({ type: "RESET" });
          onClose();
        }}
        onScan={handleScan}
      />
    );
  }

  // Analyzing / Verdict / Error phases — use overlay
  return (
    <QrAnalysisOverlay
      step={state.step}
      scannedUrl={state.scannedUrl}
      result={state.step === "verdict" ? state.result : null}
      errorMsg={state.step === "error" ? state.errorMsg : null}
      onGoBack={handleGoBack}
      onScanAnother={handleScanAnother}
    />
  );
}
