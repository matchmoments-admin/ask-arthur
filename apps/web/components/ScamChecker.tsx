"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { X, ScanLine, Paperclip, Mic, Lock, EyeOff } from "lucide-react";
import AnalysisProgress, { type Step as ProgressStep } from "./AnalysisProgress";
import ResultCard from "./ResultCard";
import ScreenshotDrawer from "./ScreenshotDrawer";
import QrScanFlow from "./QrScanFlow";
import InvalidSubmissionState from "./result/InvalidSubmissionState";
import { compressImage } from "@/lib/compressImage";
import { tryDecodeQR } from "@/lib/qrDecode";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { useMediaAnalysis } from "@/lib/hooks/useMediaAnalysis";
import type { AnalysisResponse } from "@/types/analysis";

type Status = "idle" | "analyzing" | "complete" | "error" | "rate_limited";

function makeReferenceId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ASK-${rand}`;
}

const MEDIA_STATUS_LABELS: Record<string, string> = {
  uploading: "Uploading audio...",
  transcribing: "Transcribing audio...",
  analyzing: "Analysing for scams...",
};

export default function ScamChecker() {
  const MAX_IMAGES = 10;
  const [text, setText] = useState("");
  const [images, setImages] = useState<Array<{ base64: string; preview: string; name: string }>>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "image" | "qrcode">("text");
  const [qrDecodedUrl, setQrDecodedUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<ProgressStep | undefined>(undefined);
  const [errorAttempts, setErrorAttempts] = useState(0);
  const [errorRef, setErrorRef] = useState<string | null>(null);
  const searchParams = useSearchParams();

  // Media analysis hook
  const media = useMediaAnalysis();
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill textarea from Web Share Target (Android PWA)
  useEffect(() => {
    const sharedText = searchParams.get("shared_text");
    if (sharedText) {
      setText(sharedText);
      // Clean up the URL without triggering a navigation
      window.history.replaceState({}, "", "/");
    }
  }, [searchParams]);

  const processFiles = useCallback(async (files: File[], mode?: "image" | "qrcode") => {
    // Reset QR state
    setQrError(null);
    setQrDecodedUrl(null);

    if (mode === "qrcode") {
      // QR mode: single image only
      const file = files[0];
      if (!file) return;
      setInputMode("qrcode");
      const compressed = await compressImage(file);
      const qrText = await tryDecodeQR(compressed);
      if (qrText) {
        const urlMatch = qrText.match(/https?:\/\/\S+/);
        if (urlMatch) {
          setQrDecodedUrl(urlMatch[0]);
          setText(urlMatch[0]);
        } else {
          setQrDecodedUrl(qrText);
          setText(qrText);
        }
      } else {
        setQrError("Couldn\u2019t read this QR code \u2014 try a clearer photo");
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setImages((prev) => [...prev, { base64, preview: dataUrl, name: file.name }].slice(0, MAX_IMAGES));
        setErrorMsg("");
      };
      reader.readAsDataURL(compressed);
      return;
    }

    // Image mode: process all files
    setInputMode("image");
    for (const file of files) {
      const compressed = await compressImage(file);
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setImages((prev) => {
          if (prev.length >= MAX_IMAGES) return prev;
          return [...prev, { base64, preview: dataUrl, name: file.name }];
        });
        setErrorMsg("");
      };
      reader.readAsDataURL(compressed);
    }
  }, []);

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFiles([file]);
        return;
      }
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const fileList = e.dataTransfer.files;
    if (!fileList || fileList.length === 0) return;
    const imageFiles = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length > 0) {
      processFiles(imageFiles);
    }
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
        setInputMode("text");
        setQrDecodedUrl(null);
        setQrError(null);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && images.length === 0) return;

    setStatus("analyzing");
    setResult(null);
    setErrorMsg("");
    setProgressStep("upload");

    try {
      const fetchPromise = fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim() || undefined,
          images: images.length > 0 ? images.map((i) => i.base64) : undefined,
          mode: inputMode !== "text" ? inputMode : undefined,
        }),
      });
      // Request is in-flight — advance to "lookup" (visible for the bulk of
      // the Claude round-trip since headers only return once the body is ready).
      setProgressStep("lookup");

      const res = await fetchPromise;

      if (res.status === 429) {
        const data = await res.json();
        setStatus("rate_limited");
        setProgressStep(undefined);
        setErrorMsg(data.message || "Too many requests. Please try again later.");
        return;
      }

      if (!res.ok) {
        throw new Error("Analysis failed");
      }

      setProgressStep("analyse");
      const data: AnalysisResponse = await res.json();
      setProgressStep("write");
      setResult(data);
      setStatus("complete");
      setProgressStep("done");
      setErrorAttempts(0);
      setErrorRef(null);
      window.dispatchEvent(new Event("safeverify:check-complete"));
    } catch {
      setStatus("error");
      setProgressStep(undefined);
      setErrorAttempts((n) => n + 1);
      setErrorRef(makeReferenceId());
      setErrorMsg("Something went wrong. Please try again.");
    }
  }

  function handleAudioSelect() {
    audioInputRef.current?.click();
  }

  function handleAudioChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected
    e.target.value = "";
    media.analyze(file);
  }

  function handleReset() {
    setText("");
    setImages([]);
    setInputMode("text");
    setQrDecodedUrl(null);
    setQrError(null);
    setShowQrScanner(false);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setProgressStep(undefined);
    setErrorAttempts(0);
    setErrorRef(null);
    media.reset();
  }

  // Determine if any analysis (text or media) is active
  const isMediaActive = media.status !== "idle" && media.status !== "complete" && media.status !== "error";
  const isTextActive = status === "analyzing";
  const isAnyActive = isMediaActive || isTextActive;

  // Show media result via ResultCard when complete
  const showMediaResult = media.status === "complete" && media.result;

  return (
    <div>
      <form onSubmit={handleSubmit} aria-label="Scam checker">
        {/* Unified input container */}
        <div
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-3xl overflow-hidden border-2 bg-white transition-colors ${
            isDragging
              ? "border-action-teal bg-slate-50"
              : isFocused
                ? "border-deep-navy"
                : "border-gray-200"
          }`}
        >
          {/* Image thumbnail strip */}
          {images.length > 0 && (
            <div className="flex items-center gap-2 px-4 pt-3 overflow-x-auto">
              {images.map((img, i) => (
                <div key={i} className="relative flex-shrink-0 group">
                  <img
                    src={img.preview}
                    alt={img.name || `Screenshot ${i + 1}`}
                    className="w-16 h-16 rounded-lg object-cover border border-gray-200"
                  />
                  <span className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-deep-navy text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-gray-300 rounded-full flex items-center justify-center text-slate-400 hover:text-gov-slate hover:bg-slate-100 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* QR code success notice */}
          {inputMode === "qrcode" && qrDecodedUrl && !qrError && (
            <div className="flex items-center gap-2 px-4 pt-2 text-sm text-action-teal font-medium">
              <ScanLine size={16} />
              {qrDecodedUrl.startsWith("http") ? "QR code detected \u2014 link extracted for checking" : "QR code detected \u2014 text extracted for checking"}
            </div>
          )}

          {/* QR code error notice */}
          {inputMode === "qrcode" && qrError && (
            <div className="flex items-center gap-2 px-4 pt-2 text-sm text-red-600 font-medium">
              <ScanLine size={16} />
              {qrError}
            </div>
          )}

          {/* Borderless textarea */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Paste the suspicious message, email, or URL here..."
            aria-label="Suspicious message to check"
            rows={4}
            maxLength={10000}
            disabled={isAnyActive}
            aria-busy={isAnyActive}
            className="w-full px-4 py-3 text-lg text-deep-navy border-0 focus:outline-none focus:ring-0 bg-transparent resize-y min-h-[100px] disabled:opacity-60 placeholder:text-slate-400"
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              {/* Attach button — opens image source drawer */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  disabled={images.length >= MAX_IMAGES}
                  className="w-11 h-11 flex items-center justify-center rounded-full text-gov-slate hover:text-deep-navy hover:bg-slate-100 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Attach screenshot"
                >
                  <Paperclip size={20} />
                </button>
                {images.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-action-teal text-white text-[10px] font-bold rounded-full flex items-center justify-center pointer-events-none">
                    {images.length}
                  </span>
                )}
              </div>

              {/* Audio upload button — gated by feature flag */}
              {featureFlags.mediaAnalysis && (
                <button
                  type="button"
                  onClick={handleAudioSelect}
                  disabled={isAnyActive}
                  className="w-11 h-11 flex items-center justify-center rounded-full text-gov-slate hover:text-deep-navy hover:bg-slate-100 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Upload audio recording"
                >
                  <Mic size={20} />
                </button>
              )}
            </div>

            {/* Submit / Reset button */}
            {(status === "complete" || showMediaResult) ? (
              <button
                type="button"
                onClick={handleReset}
                className="h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
              >
                Check Another
              </button>
            ) : (
              <button
                type="submit"
                disabled={isAnyActive || (!text.trim() && images.length === 0)}
                className="h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {isTextActive ? "Analysing..." : "Check Now"}
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Hidden audio file input */}
      {featureFlags.mediaAnalysis && (
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          onChange={handleAudioChange}
          className="hidden"
          aria-hidden="true"
        />
      )}

      <ScreenshotDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onFilesSelected={processFiles}
        onScanQrCode={() => {
          setDrawerOpen(false);
          setShowQrScanner(true);
        }}
      />

      <QrScanFlow
        open={showQrScanner}
        onClose={() => setShowQrScanner(false)}
      />

      {/* Privacy line */}
      <div className="flex items-center justify-center gap-2 mt-4 text-xs font-bold uppercase tracking-widest text-gov-slate">
        <Lock size={14} />
        <EyeOff size={14} />
        We never store your data
      </div>
      <p className="text-[11px] text-slate-400 text-center max-w-md mx-auto mt-1.5">
        Your message is sent to our AI for analysis then immediately discarded.
        No personal data is stored.{" "}
        <a href="/privacy" className="underline hover:text-slate-500">
          Privacy policy
        </a>
      </p>

      {/* Media analysis progress */}
      {isMediaActive && (
        <div className="mt-6 flex items-center gap-3 justify-center">
          <div className="w-5 h-5 border-2 border-deep-navy border-t-transparent rounded-full animate-spin" />
          <p className="text-gov-slate text-base">
            {MEDIA_STATUS_LABELS[media.status] || "Processing..."}
          </p>
        </div>
      )}

      {/* Text analysis progress */}
      <AnalysisProgress
        status={status}
        currentStep={featureFlags.resultScreenV2 ? progressStep : undefined}
      />

      {/* Result */}
      <div aria-live="polite">
      {/* Text analysis result */}
      {result && status === "complete" && (
          <ResultCard
            verdict={result.verdict}
            confidence={result.confidence}
            summary={result.summary}
            redFlags={result.redFlags}
            nextSteps={result.nextSteps}
            countryCode={result.countryCode}
            phoneRiskFlags={result.phoneRiskFlags}
            isVoipCaller={result.isVoipCaller}
            scamType={result.scamType}
            impersonatedBrand={result.impersonatedBrand}
            scammerContacts={result.scammerContacts}
            scammerUrls={result.scammerUrls}
            channel={result.channel}
            inputMode={result.inputMode || inputMode}
            onCheckAnother={handleReset}
          />
      )}

      {/* Media analysis result */}
      {showMediaResult && media.result && (
        <ResultCard
          verdict={media.result.verdict as "SAFE" | "SUSPICIOUS" | "HIGH_RISK"}
          confidence={media.result.confidence}
          summary={media.result.summary}
          redFlags={media.result.redFlags}
          nextSteps={media.result.nextSteps}
          deepfakeScore={media.result.deepfakeScore}
          deepfakeProvider={media.result.deepfakeProvider}
          phoneRiskFlags={media.result.phoneRiskFlags}
          onCheckAnother={handleReset}
        />
      )}

      {/* Error: info-blue invalid-state panel when V2 is on, plain warn
          banner otherwise. Rate-limit always uses the warn banner — info-blue
          is reserved for scrape / parse failures, not throttling. */}
      {status === "error" && featureFlags.resultScreenV2 && (
        <InvalidSubmissionState
          referenceId={errorRef ?? undefined}
          attemptCount={errorAttempts}
          onRetry={() => {
            setStatus("idle");
            setErrorMsg("");
          }}
          onUploadScreenshot={() => setDrawerOpen(true)}
        />
      )}
      {((status === "error" && !featureFlags.resultScreenV2) ||
        status === "rate_limited") && (
        <div role="alert" className="mt-6 p-4 bg-warn-bg border border-warn-border rounded-[4px]">
          <p className="text-warn-heading text-base">{errorMsg}</p>
          {status === "rate_limited" && (
            <p className="text-gov-slate text-sm mt-2">
              This limit helps us keep the service free for everyone.
            </p>
          )}
        </div>
      )}

      {/* Media analysis errors */}
      {media.status === "error" && media.error && (
        <div role="alert" className="mt-6 p-4 bg-warn-bg border border-warn-border rounded-[4px]">
          <p className="text-warn-heading text-base">{media.error}</p>
        </div>
      )}
      </div>
    </div>
  );
}
