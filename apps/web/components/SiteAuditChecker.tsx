"use client";

import { useState, useEffect, useCallback } from "react";
import { Globe, ShieldCheck, Clock, RotateCcw, Trash2 } from "lucide-react";
import SiteAuditProgress from "./SiteAuditProgress";
import SiteAuditReport from "./SiteAuditReport";
import type { SiteAuditResult } from "./SiteAuditReport";

type Status = "idle" | "scanning" | "complete" | "error" | "rate_limited";

interface ScanHistoryEntry {
  domain: string;
  url: string;
  grade: string;
  score: number;
  scannedAt: string;
  shareUrl?: string;
}

interface SSEProgress {
  phase: string;
  completed: number;
  total: number;
}

const HISTORY_KEY = "askarthur:scan-history";
const MAX_HISTORY = 20;

function loadHistory(): ScanHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as ScanHistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: ScanHistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable
  }
}

function addToHistory(entry: ScanHistoryEntry) {
  const history = loadHistory();
  // Remove existing entry for same domain
  const filtered = history.filter((h) => h.domain !== entry.domain);
  // Add new entry at the start
  filtered.unshift(entry);
  // Keep only MAX_HISTORY entries
  saveHistory(filtered.slice(0, MAX_HISTORY));
}

function getPreviousScan(domain: string): { grade: string; score: number } | null {
  const history = loadHistory();
  const prev = history.find((h) => h.domain === domain);
  if (!prev) return null;
  return { grade: prev.grade, score: prev.score };
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

const GRADE_PILL_COLORS: Record<string, string> = {
  "A+": "bg-green-100 text-green-800",
  A: "bg-green-100 text-green-800",
  B: "bg-teal-100 text-teal-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-orange-100 text-orange-800",
  F: "bg-red-100 text-red-800",
};

export default function SiteAuditChecker() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SiteAuditResult | null>(null);
  const [shareUrl, setShareUrl] = useState<string | undefined>();
  const [errorMsg, setErrorMsg] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [progress, setProgress] = useState<SSEProgress | null>(null);
  const [previousScan, setPreviousScan] = useState<{ grade: string; score: number } | null>(null);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent, prefillUrl?: string) => {
    if (e) e.preventDefault();
    const trimmed = (prefillUrl || url).trim();
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

    // Check for previous scan before starting
    try {
      const domain = new URL(normalized).hostname;
      setPreviousScan(getPreviousScan(domain));
    } catch {
      setPreviousScan(null);
    }

    setStatus("scanning");
    setResult(null);
    setShareUrl(undefined);
    setErrorMsg("");
    setProgress(null);

    try {
      const res = await fetch("/api/site-audit/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized }),
      });

      // Handle non-SSE error responses
      if (res.status === 429) {
        const data = await res.json();
        setStatus("rate_limited");
        setErrorMsg(data.message || "Too many requests. Please try again later.");
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Health check failed");
      }

      // Parse SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Stream not available");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // Keep incomplete event in buffer

        for (const eventBlock of events) {
          if (!eventBlock.trim()) continue;

          let eventType = "";
          let eventData = "";

          for (const line of eventBlock.split("\n")) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7);
            } else if (line.startsWith("data: ")) {
              eventData = line.slice(6);
            }
          }

          if (!eventType || !eventData) continue;

          try {
            const parsed = JSON.parse(eventData);

            if (eventType === "progress") {
              setProgress(parsed);
            } else if (eventType === "complete") {
              setResult(parsed as SiteAuditResult);
              setStatus("complete");

              // Save to history
              const scanResult = parsed as SiteAuditResult;
              addToHistory({
                domain: scanResult.domain,
                url: scanResult.url,
                grade: scanResult.grade,
                score: scanResult.overallScore,
                scannedAt: scanResult.scannedAt,
                shareUrl: undefined, // Will be set by share event
              });
              setHistory(loadHistory());
            } else if (eventType === "share") {
              setShareUrl(parsed.shareUrl);
              // Update history with share URL
              const h = loadHistory();
              if (h.length > 0 && parsed.shareUrl) {
                h[0].shareUrl = parsed.shareUrl;
                saveHistory(h);
                setHistory([...h]);
              }
            } else if (eventType === "error") {
              throw new Error(parsed.message || "Scan failed");
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Scan failed" && !parseErr.message.includes("private")) {
              // JSON parse error — skip this event
              continue;
            }
            throw parseErr;
          }
        }
      }

      // If we never got a complete event, set status
      if (status === "scanning") {
        setStatus("complete");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    }
  }, [url, status]);

  function handleReset() {
    setUrl("");
    setStatus("idle");
    setResult(null);
    setShareUrl(undefined);
    setErrorMsg("");
    setProgress(null);
    setPreviousScan(null);
  }

  function handleRescan(historyUrl: string) {
    setUrl(historyUrl);
    handleSubmit(undefined, historyUrl);
  }

  function clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // Ignore
    }
    setHistory([]);
  }

  return (
    <div>
      <form onSubmit={handleSubmit} aria-label="Website health check">
        <div
          className={`rounded-3xl overflow-hidden border-2 bg-white transition-colors ${
            isFocused ? "border-deep-navy" : "border-gray-200"
          }`}
        >
          {/* URL input */}
          <div className="flex items-center gap-2 px-4 py-1">
            <Globe className="text-gov-slate flex-shrink-0" size={20} />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Enter a website URL (e.g. example.com.au)"
              aria-label="Website URL to check"
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
        <ShieldCheck size={14} />
        Non-intrusive scan only
      </div>
      <p className="text-[11px] text-slate-400 text-center max-w-md mx-auto mt-1.5">
        We only check publicly observable security headers and configuration.
        No penetration testing or private data access.
      </p>

      {/* Recent scans (when idle) */}
      {status === "idle" && history.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gov-slate">
              Recent Scans
            </h3>
            <button
              onClick={clearHistory}
              className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold uppercase tracking-wider flex items-center gap-1 transition-colors"
            >
              <Trash2 size={10} />
              Clear
            </button>
          </div>
          <div className="space-y-2">
            {history.slice(0, 5).map((entry) => (
              <button
                key={entry.domain}
                onClick={() => handleRescan(entry.url)}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-slate-50 transition-colors text-left"
              >
                <span
                  className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    GRADE_PILL_COLORS[entry.grade] || "bg-slate-100 text-slate-800"
                  }`}
                >
                  {entry.grade}
                </span>
                <span className="flex-1 text-sm text-deep-navy font-medium truncate">
                  {entry.domain}
                </span>
                <span className="text-xs text-slate-400 flex items-center gap-1 flex-shrink-0">
                  <Clock size={10} />
                  {relativeTime(entry.scannedAt)}
                </span>
                <RotateCcw size={12} className="text-slate-300 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Progress */}
      <SiteAuditProgress status={status} sseProgress={progress} />

      {/* Result */}
      <div aria-live="polite">
        {result && status === "complete" && (
          <SiteAuditReport
            result={result}
            shareUrl={shareUrl}
            previousScan={previousScan}
          />
        )}

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
