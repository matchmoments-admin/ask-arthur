"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import AnalysisProgress from "./AnalysisProgress";
import ResultCard from "./ResultCard";
import ScreenshotDrawer from "./ScreenshotDrawer";
import QrScanner from "./QrScanner";
import { compressImage } from "@/lib/compressImage";
import { tryDecodeQR } from "@/lib/qrDecode";
import { featureFlags } from "@/lib/featureFlags";
import { useMediaAnalysis } from "@/lib/hooks/useMediaAnalysis";
import type { ScammerContacts } from "@/lib/claude";
import ScamReportCard from "./ScamReportCard";

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface ScammerUrl {
  url: string;
  isMalicious: boolean;
  sources: string[];
}

interface AnalysisResponse {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
  scammerContacts?: ScammerContacts;
  scammerUrls?: ScammerUrl[];
  inputMode?: string;
  scamType?: string;
  impersonatedBrand?: string;
  channel?: string;
}

type Status = "idle" | "analyzing" | "complete" | "error" | "rate_limited";

const MEDIA_STATUS_LABELS: Record<string, string> = {
  uploading: "Uploading audio...",
  transcribing: "Transcribing audio...",
  analyzing: "Analyzing for scams...",
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

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim() || undefined,
          images: images.length > 0 ? images.map((i) => i.base64) : undefined,
          mode: inputMode !== "text" ? inputMode : undefined,
        }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setStatus("rate_limited");
        setErrorMsg(data.message || "Too many requests. Please try again later.");
        return;
      }

      if (!res.ok) {
        throw new Error("Analysis failed");
      }

      const data: AnalysisResponse = await res.json();
      setResult(data);
      setStatus("complete");
      window.dispatchEvent(new Event("safeverify:check-complete"));
    } catch {
      setStatus("error");
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
    media.reset();
  }

  function handleCameraQrScan(decodedText: string) {
    setShowQrScanner(false);
    setInputMode("qrcode");
    const urlMatch = decodedText.match(/https?:\/\/\S+/);
    if (urlMatch) {
      setQrDecodedUrl(urlMatch[0]);
      setText(urlMatch[0]);
    } else {
      setQrDecodedUrl(decodedText);
      setText(decodedText);
    }
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
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-white border border-gray-300 rounded-full flex items-center justify-center text-slate-400 hover:text-gov-slate hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                  >
                    <span className="material-symbols-outlined text-xs">close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* QR code success notice */}
          {inputMode === "qrcode" && qrDecodedUrl && !qrError && (
            <div className="flex items-center gap-2 px-4 pt-2 text-sm text-action-teal font-medium">
              <span className="material-symbols-outlined text-base">qr_code_scanner</span>
              {qrDecodedUrl.startsWith("http") ? "QR code detected \u2014 link extracted for checking" : "QR code detected \u2014 text extracted for checking"}
            </div>
          )}

          {/* QR code error notice */}
          {inputMode === "qrcode" && qrError && (
            <div className="flex items-center gap-2 px-4 pt-2 text-sm text-red-600 font-medium">
              <span className="material-symbols-outlined text-base">qr_code_scanner</span>
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
                  <span className="material-symbols-outlined text-xl">attach_file</span>
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
                  <span className="material-symbols-outlined text-xl">mic</span>
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
                {isTextActive ? "Analyzing..." : "Check Now"}
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

      <QrScanner
        open={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onScan={handleCameraQrScan}
      />

      {/* Privacy line */}
      <div className="flex items-center justify-center gap-2 mt-4 text-xs font-bold uppercase tracking-widest text-gov-slate">
        <span className="material-symbols-outlined text-sm">lock</span>
        <span className="material-symbols-outlined text-sm">visibility_off</span>
        We never store your data
      </div>

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
      <AnalysisProgress status={status} />

      {/* Result */}
      <div aria-live="polite">
      {/* Text analysis result */}
      {result && status === "complete" && (
        <>
          <ResultCard
            verdict={result.verdict}
            confidence={result.confidence}
            summary={result.summary}
            redFlags={result.redFlags}
            nextSteps={result.nextSteps}
            countryCode={result.countryCode}
          />
          {featureFlags.scamContactReporting && (result.scammerContacts || result.scammerUrls) && (
            <ScamReportCard
              contacts={result.scammerContacts}
              scammerUrls={result.scammerUrls}
              scamType={result.scamType}
              brandImpersonated={result.impersonatedBrand}
              channel={result.channel}
              sourceType={result.inputMode || inputMode}
            />
          )}
        </>
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
        />
      )}

      {/* Error / rate limit messages (text analysis) */}
      {(status === "error" || status === "rate_limited") && (
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
