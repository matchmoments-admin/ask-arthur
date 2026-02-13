"use client";

import { useState, useRef } from "react";
import AnalysisProgress from "./AnalysisProgress";
import ResultCard from "./ResultCard";

type Verdict = "SAFE" | "SUSPICIOUS" | "HIGH_RISK";

interface AnalysisResponse {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
}

type Status = "idle" | "analyzing" | "complete" | "error" | "rate_limited";

export default function ScamChecker() {
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<AnalysisResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 4 * 1024 * 1024) {
      setErrorMsg("Image must be under 4MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setImageData(base64);
      setImageName(file.name);
    };
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImageData(null);
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
    setImageName(null);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div>
      <form onSubmit={handleSubmit} aria-label="Scam checker">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the suspicious message, email, or URL here..."
          aria-label="Suspicious message to check"
          rows={6}
          maxLength={10000}
          disabled={status === "analyzing"}
          aria-busy={status === "analyzing"}
          className="w-full px-4 py-3 text-base text-deep-navy border-2 border-gray-200 rounded-[4px] resize-y min-h-[120px] h-48 md:h-64 bg-white disabled:opacity-60 placeholder:text-slate-400 focus:border-deep-navy focus:ring-0"
        />

        {/* Image attachment preview */}
        {imageName && (
          <div className="flex items-center gap-2 mt-2 text-sm text-gov-slate">
            <span className="material-symbols-outlined text-base">attach_file</span>
            <span>{imageName}</span>
            <button
              type="button"
              onClick={removeImage}
              className="text-slate-400 hover:text-gov-slate"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        )}

        {/* Upload area */}
        <div className="bg-slate-50 border-t border-gray-200 -mx-0 px-4 py-3 mt-0 rounded-b-[4px]">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            id="screenshot-upload"
          />
          <label
            htmlFor="screenshot-upload"
            className="inline-flex items-center gap-1.5 text-sm text-gov-slate hover:text-deep-navy cursor-pointer"
          >
            <span className="material-symbols-outlined text-lg">add_photo_alternate</span>
            Upload screenshot
          </label>
        </div>

        {/* Submit / Reset button */}
        <div className="mt-4">
          {status === "complete" ? (
            <button
              type="button"
              onClick={handleReset}
              className="w-full py-4 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
            >
              Check Another
            </button>
          ) : (
            <button
              type="submit"
              disabled={status === "analyzing" || (!text.trim() && !imageData)}
              className="w-full py-4 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "analyzing" ? "Analyzing..." : "Check Now"}
            </button>
          )}
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
