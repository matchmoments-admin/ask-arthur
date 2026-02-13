"use client";

import { useState, useRef, useCallback } from "react";
import AnalysisProgress from "./AnalysisProgress";
import ResultCard from "./ResultCard";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (file.size > 4 * 1024 * 1024) {
      setErrorMsg("Image must be under 4MB");
      return;
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
    reader.readAsDataURL(file);
  }, []);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
  }

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
    if (fileInputRef.current) fileInputRef.current.value = "";
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
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Please try again.");
    }
  }

  function handleReset() {
    setText("");
    setImageData(null);
    setImagePreview(null);
    setImageName(null);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <form onSubmit={handleSubmit} aria-label="Scam checker">
        {/* Unified input container */}
        <div
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded-3xl border-2 bg-white transition-colors ${
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
            disabled={status === "analyzing"}
            aria-busy={status === "analyzing"}
            className="w-full px-4 py-3 text-lg text-deep-navy border-0 focus:outline-none focus:ring-0 bg-transparent resize-y min-h-[100px] disabled:opacity-60 placeholder:text-slate-400"
          />

          {/* Bottom toolbar */}
          <div className="flex items-center justify-between px-3 pb-3">
            {/* Attach button */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageUpload}
              className="hidden"
              id="screenshot-upload"
            />
            <label
              htmlFor="screenshot-upload"
              className="w-11 h-11 flex items-center justify-center rounded-full text-gov-slate hover:text-deep-navy hover:bg-slate-100 cursor-pointer transition-colors"
              aria-label="Attach screenshot"
            >
              <span className="material-symbols-outlined text-xl">attach_file</span>
            </label>

            {/* Submit / Reset button */}
            {status === "complete" ? (
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
                disabled={status === "analyzing" || (!text.trim() && !imageData)}
                className="h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {status === "analyzing" ? "Analyzing..." : "Check Now"}
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Privacy line */}
      <div className="flex items-center justify-center gap-2 mt-4 text-xs font-bold uppercase tracking-widest text-gov-slate">
        <span className="material-symbols-outlined text-sm">lock</span>
        <span className="material-symbols-outlined text-sm">visibility_off</span>
        We never store your data
      </div>

      {/* Analysis progress */}
      <AnalysisProgress status={status} />

      {/* Result */}
      <div aria-live="polite">
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

      {/* Error / rate limit messages */}
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
      </div>
    </div>
  );
}
