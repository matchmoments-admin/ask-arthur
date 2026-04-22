"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Globe,
  Puzzle,
  Plug,
  Zap,
  Search,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { detectInput, SCAN_TYPE_LABELS, INPUT_EXAMPLES } from "@/lib/input-detector";
import type { DetectedInput } from "@/lib/input-detector";
import type { UnifiedScanResult } from "@askarthur/types/scanner";
import SiteAuditProgress from "./SiteAuditProgress";
import SiteAuditReport from "./SiteAuditReport";
import type { SiteAuditResult } from "./SiteAuditReport";
import ScanResultReport from "./ScanResultReport";

type Status = "idle" | "scanning" | "complete" | "error" | "rate_limited";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  website: <Globe size={16} />,
  extension: <Puzzle size={16} />,
  "mcp-server": <Plug size={16} />,
  skill: <Zap size={16} />,
  "mcp-config": <Plug size={16} />,
  unknown: <Search size={16} />,
};

const TYPE_CHIP_COLORS: Record<string, string> = {
  website: "bg-blue-50 text-blue-700 border-blue-200",
  extension: "bg-purple-50 text-purple-700 border-purple-200",
  "mcp-server": "bg-emerald-50 text-emerald-700 border-emerald-200",
  skill: "bg-amber-50 text-amber-700 border-amber-200",
  "mcp-config": "bg-emerald-50 text-emerald-700 border-emerald-200",
  unknown: "bg-slate-50 text-slate-500 border-slate-200",
};

interface SSEProgress {
  phase: string;
  completed: number;
  total: number;
}

export default function UniversalScanner() {
  const [input, setInput] = useState("");
  const [detected, setDetected] = useState<DetectedInput | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<SiteAuditResult | null>(null);
  const [shareUrl, setShareUrl] = useState<string | undefined>();
  const [errorMsg, setErrorMsg] = useState("");
  const [progress, setProgress] = useState<SSEProgress | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cycle placeholder examples
  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % INPUT_EXAMPLES.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  // Auto-detect input type as user types
  useEffect(() => {
    if (!input.trim()) {
      setDetected(null);
      return;
    }
    const result = detectInput(input);
    setDetected(result);
  }, [input]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!detected || detected.type === "unknown") return;

      setStatus("scanning");
      setResult(null);
      setShareUrl(undefined);
      setErrorMsg("");
      setProgress(null);

      try {
        if (detected.type === "website") {
          // Use existing site-audit SSE stream
          const res = await fetch("/api/site-audit/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: detected.value }),
          });

          if (res.status === 429) {
            setStatus("rate_limited");
            setErrorMsg("Too many requests. Please try again later.");
            return;
          }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Scan failed");
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
            const events = buffer.split("\n\n");
            buffer = events.pop() || "";

            for (const eventBlock of events) {
              if (!eventBlock.trim()) continue;
              let eventType = "";
              let eventData = "";
              for (const line of eventBlock.split("\n")) {
                if (line.startsWith("event:")) eventType = line.slice(6).trim();
                if (line.startsWith("data:")) eventData = line.slice(5).trim();
              }
              if (!eventData) continue;

              try {
                const parsed = JSON.parse(eventData);
                if (eventType === "progress") setProgress(parsed);
                if (eventType === "complete") {
                  setResult(parsed);
                  setStatus("complete");
                }
                if (eventType === "share") setShareUrl(parsed.url);
                if (eventType === "error") {
                  setErrorMsg(parsed.message || "Scan failed");
                  setStatus("error");
                }
              } catch {
                // Skip malformed events
              }
            }
          }

          if (status === "scanning") setStatus("complete");
        } else {
          // Extension, MCP, Skill — use POST API (to be implemented)
          const endpoint =
            detected.type === "extension"
              ? "/api/extension-audit"
              : detected.type === "mcp-server" || detected.type === "mcp-config"
                ? "/api/mcp-audit"
                : "/api/skill-audit";

          const body =
            detected.type === "extension"
              ? { extensionId: (detected as Extract<DetectedInput, { type: "extension" }>).extensionId }
              : detected.type === "mcp-server"
                ? { packageName: (detected as Extract<DetectedInput, { type: "mcp-server" }>).packageName }
                : detected.type === "skill"
                  ? { skillId: (detected as Extract<DetectedInput, { type: "skill" }>).skillId }
                  : { config: detected.value };

          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          if (res.status === 429) {
            setStatus("rate_limited");
            setErrorMsg("Too many requests. Please try again later.");
            return;
          }
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.message || "Scan failed");
          }

          const data = await res.json();
          setResult(data);
          setStatus("complete");
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Scan failed");
        setStatus("error");
      }
    },
    [detected, status]
  );

  const currentExample = INPUT_EXAMPLES[placeholderIdx];
  const chipType = detected?.type || "unknown";
  const chipLabel = SCAN_TYPE_LABELS[chipType as keyof typeof SCAN_TYPE_LABELS];
  const canSubmit = detected && detected.type !== "unknown" && status !== "scanning";

  return (
    <div className="w-full">
      {/* Input bar */}
      {status !== "complete" && (
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex items-center gap-3 border border-border-light rounded-xl bg-white px-4 py-3 shadow-sm focus-within:border-deep-navy focus-within:shadow-md transition-all">
            {/* Type chip */}
            {detected && detected.type !== "unknown" && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border shrink-0 transition-all ${TYPE_CHIP_COLORS[chipType]}`}
              >
                {TYPE_ICONS[chipType]}
                {chipLabel.label}
              </span>
            )}

            {/* Input */}
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Try "${currentExample.text}"`}
              className="flex-1 text-base text-deep-navy placeholder:text-slate-400 bg-transparent outline-none min-w-0"
              disabled={status === "scanning"}
            />

            {/* Submit button */}
            <button
              type="submit"
              disabled={!canSubmit}
              className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-deep-navy text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-navy transition-colors"
            >
              {status === "scanning" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <ArrowRight size={18} />
              )}
            </button>
          </div>

          {/* Scan type hints below input */}
          {!input && status === "idle" && (
            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-slate-400">
              <span className="flex items-center gap-1">{TYPE_ICONS.website} Website</span>
              <span className="flex items-center gap-1">{TYPE_ICONS.extension} Extension</span>
              <span className="flex items-center gap-1">{TYPE_ICONS["mcp-server"]} MCP Server</span>
              <span className="flex items-center gap-1">{TYPE_ICONS.skill} AI Skill</span>
            </div>
          )}
        </form>
      )}

      {/* Scanning progress */}
      {status === "scanning" && detected?.type === "website" && (
        <div className="mt-8">
          <SiteAuditProgress
            status="scanning"
            sseProgress={progress}
          />
        </div>
      )}

      {status === "scanning" && detected?.type !== "website" && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <Loader2 size={32} className="animate-spin text-deep-navy" />
          <p className="text-sm text-gov-slate">
            Scanning {chipLabel.label.toLowerCase()}...
          </p>
        </div>
      )}

      {/* Error states */}
      {status === "error" && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {errorMsg || "Something went wrong. Please try again."}
          <button
            onClick={() => { setStatus("idle"); setErrorMsg(""); }}
            className="block mt-2 text-red-600 underline text-xs"
          >
            Try again
          </button>
        </div>
      )}

      {status === "rate_limited" && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          {errorMsg}
        </div>
      )}

      {/* Results — website uses existing SiteAuditReport */}
      {status === "complete" && result && detected?.type === "website" && (
        <div className="mt-6">
          <button
            onClick={() => { setStatus("idle"); setResult(null); setInput(""); }}
            className="mb-4 text-sm text-gov-slate hover:text-deep-navy transition-colors"
          >
            ← Scan another
          </button>
          <SiteAuditReport
            result={result}
            shareUrl={shareUrl}
            previousScan={null}
          />
        </div>
      )}

      {/* Results — extension, MCP, skill scans */}
      {status === "complete" && result && detected?.type !== "website" && (
        <div className="mt-6">
          <button
            onClick={() => { setStatus("idle"); setResult(null); setInput(""); }}
            className="mb-4 text-sm text-gov-slate hover:text-deep-navy transition-colors"
          >
            ← Scan another
          </button>
          <ScanResultReport
            result={result as unknown as UnifiedScanResult}
            shareUrl={shareUrl}
          />
        </div>
      )}
    </div>
  );
}
