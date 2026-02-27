"use client";

import { useState } from "react";
import SiteAuditProgress from "./SiteAuditProgress";
import SiteAuditReport from "./SiteAuditReport";
import type { SiteAuditResult } from "./SiteAuditReport";

type Status = "idle" | "scanning" | "complete" | "error" | "rate_limited";

export default function SiteAuditChecker() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SiteAuditResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    // Prepend https:// if missing for URL validation
    let normalized = trimmed;
    if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
      normalized = `https://${normalized}`;
    }

    // Basic client-side URL validation
    try {
      new URL(normalized);
    } catch {
      setErrorMsg("Please enter a valid website URL.");
      setStatus("error");
      return;
    }

    setStatus("scanning");
    setResult(null);
    setErrorMsg("");

    try {
      const res = await fetch("/api/site-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setStatus("rate_limited");
        setErrorMsg(data.message || "Too many requests. Please try again later.");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Audit failed");
      }

      const data: SiteAuditResult = await res.json();
      setResult(data);
      setStatus("complete");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    }
  }

  function handleReset() {
    setUrl("");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
  }

  return (
    <div>
      <form onSubmit={handleSubmit} aria-label="Website audit">
        <div
          className={`rounded-3xl overflow-hidden border-2 bg-white transition-colors ${
            isFocused ? "border-deep-navy" : "border-gray-200"
          }`}
        >
          {/* URL input */}
          <div className="flex items-center gap-2 px-4 py-1">
            <span className="material-symbols-outlined text-gov-slate text-xl flex-shrink-0">
              language
            </span>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Enter a website URL (e.g. example.com.au)"
              aria-label="Website URL to audit"
              maxLength={2048}
              disabled={status === "scanning"}
              className="flex-1 py-3 text-lg text-deep-navy border-0 focus:outline-none focus:ring-0 bg-transparent disabled:opacity-60 placeholder:text-slate-400"
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex items-center justify-end px-3 pb-3">
            {status === "complete" ? (
              <button
                type="button"
                onClick={handleReset}
                className="h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors text-sm"
              >
                Scan Another
              </button>
            ) : (
              <button
                type="submit"
                disabled={status === "scanning" || !url.trim()}
                className="h-11 px-6 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-full hover:bg-navy transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {status === "scanning" ? "Scanning..." : "Scan Now"}
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Privacy line */}
      <div className="flex items-center justify-center gap-2 mt-4 text-xs font-bold uppercase tracking-widest text-gov-slate">
        <span className="material-symbols-outlined text-sm">security</span>
        Non-intrusive scan only
      </div>
      <p className="text-[11px] text-slate-400 text-center max-w-md mx-auto mt-1.5">
        We only check publicly observable security headers and configuration.
        No penetration testing or private data access.
      </p>

      {/* Progress */}
      <SiteAuditProgress status={status} />

      {/* Result */}
      <div aria-live="polite">
        {result && status === "complete" && <SiteAuditReport result={result} />}

        {(status === "error" || status === "rate_limited") && (
          <div
            role="alert"
            className="mt-6 p-4 bg-warn-bg border border-warn-border rounded-[4px]"
          >
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
