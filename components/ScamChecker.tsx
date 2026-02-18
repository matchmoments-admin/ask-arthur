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

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface AnalysisResponse {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  countryCode?: string | null;
}

type Status = "idle" | "analyzing" | "complete" | "error" | "rate_limited";

const MEDIA_STATUS_LABELS: Record<string, string> = {
  uploading: "Uploading audio...",
  transcribing: "Transcribing audio...",
  analyzing: "Analyzing for scams...",
};

export default function ScamChecker() {
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
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

  const processFile = useCallback(async (file: File, mode?: "image" | "qrcode") => {
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg("Image must be under 10MB");
      return;
    }

    // Reset QR state
    setQrError(null);
    setQrDecodedUrl(null);

    const compressed = await compressImage(file);

    if (mode === "qrcode") {
      setInputMode("qrcode");
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
    } else {
      setInputMode("image");
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      setImageData(base64);
      setImagePreview(dataUrl);
      setImageName(file.name);
      setErrorMsg("");
    };
    reader.readAsDataURL(compressed);
  }, []);

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processFile(file);
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
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) {
      processFile(file);
    }
  }

  function removeImage() {
    setImageData(null);
    setImagePreview(null);
    setImageName(null);
    setInputMode("text");
    setQrDecodedUrl(null);
    setQrError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() && !imageData) return;

    setStatus("analyzing");
    setResult(null);
    setErrorMsg("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim() || undefined,
          image: imageData || undefined,
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
    setImageData(null);
    setImagePreview(null);
    setImageName(null);
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
          {/* Image thumbnail preview */}
          {imagePreview && (
            <div className="flex items-center gap-3 px-4 pt-3">
              <img
                src={imagePreview}
                alt={imageName || "Attached image"}
                className="w-16 h-16 rounded-lg object-cover border border-gray-200"
              />
              <span className="text-sm text-gov-slate truncate flex-1">{imageName}</span>
              <button
                type="button"
                onClick={removeImage}
                aria-label="Remove image"
                className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-gov-slate hover:bg-slate-100 transition-colors"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
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
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="w-11 h-11 flex items-center justify-center rounded-full text-gov-slate hover:text-deep-navy hover:bg-slate-100 cursor-pointer transition-colors"
                aria-label="Attach screenshot"
              >
                <span className="material-symbols-outlined text-xl">attach_file</span>
              </button>

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
                disabled={isAnyActive || (!text.trim() && !imageData)}
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
        onFileSelected={processFile}
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
        <ResultCard
          verdict={result.verdict}
          confidence={result.confidence}
          summary={result.summary}
          redFlags={result.redFlags}
          nextSteps={result.nextSteps}
          countryCode={result.countryCode}
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
