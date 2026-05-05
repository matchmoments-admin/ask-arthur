"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";

// Round-2 audit (b) closure — render scrubbed prior reports under the
// verdict so the user sees "we've seen this exact pattern before". The
// retrieval pipeline is already live behind /api/analyze/similar:
//   embedQuery → match_scam_reports_hybrid (BM25 ∪ dense + RRF) → rerank-2.5-lite
// Cost ≤ $0.0002/uncached call; cache is keyed by SHA-256 of the input
// text for 1h, so re-renders of the same submission are free.
//
// Decorative surface: any failure (network, upstream timeout, empty pool)
// hides the section silently rather than 5xx-ing the result page. The
// verdict is the load-bearing UX; this is supporting evidence.

interface SimilarReport {
  id: number;
  scamType: string | null;
  verdict: "SUSPICIOUS" | "HIGH_RISK" | "UNCERTAIN";
  confidenceScore: number;
  impersonatedBrand: string | null;
  channel: string | null;
  region: string | null;
  scrubbedContent: string | null;
  createdAt: string;
  similarity: number;
  rerankRelevance: number;
}

interface ApiResponse {
  reports: SimilarReport[];
  cached: boolean;
  requestId: string;
  error?: string;
}

interface Props {
  text: string;
}

type State =
  | { status: "loading" }
  | { status: "ready"; reports: SimilarReport[] }
  | { status: "hidden" };

const MAX_REPORTS = 3;
const EXCERPT_MAX_CHARS = 240;
const EXCERPT_SOFT_BREAK = 200;

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "recently";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function excerpt(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  if (t.length <= EXCERPT_MAX_CHARS) return t;
  const cut = t.slice(0, EXCERPT_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  const sliced = lastSpace > EXCERPT_SOFT_BREAK ? cut.slice(0, lastSpace) : cut;
  return `${sliced}…`;
}

function metaLine(r: SimilarReport): string {
  const parts: string[] = [];
  if (r.scamType) {
    parts.push(r.scamType.replace(/_/g, " "));
  } else if (r.verdict === "HIGH_RISK") {
    parts.push("Reported scam");
  } else {
    parts.push("Suspicious");
  }
  if (r.region) parts.push(r.region);
  if (r.channel) parts.push(`via ${r.channel.toLowerCase()}`);
  return parts.join(" · ");
}

export default function SimilarReports({ text }: Props) {
  // Lazy initial state — the empty-text branch resolves at first render
  // without a follow-up setState call (which would have triggered the
  // react-hooks/cascading-renders lint rule). The parent guards against
  // empty text but we keep the check defensively.
  const [state, setState] = useState<State>(() =>
    text.trim().length === 0
      ? ({ status: "hidden" } as State)
      : ({ status: "loading" } as State),
  );

  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/analyze/similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "hidden" });
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;
        if (!Array.isArray(json.reports) || json.reports.length === 0) {
          setState({ status: "hidden" });
          return;
        }
        setState({
          status: "ready",
          reports: json.reports.slice(0, MAX_REPORTS),
        });
      } catch {
        if (!cancelled) setState({ status: "hidden" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text]);

  if (state.status === "hidden") return null;

  return (
    <section
      className="mt-6 rounded-lg border border-slate-200 bg-white px-5 py-5 sm:px-6 sm:py-6"
      aria-labelledby="similar-reports-heading"
    >
      <div className="flex items-center gap-3 mb-4">
        <History
          size={20}
          className="text-deep-navy shrink-0"
          aria-hidden="true"
        />
        <h3
          id="similar-reports-heading"
          className="text-base font-bold text-deep-navy"
        >
          Similar reports we&apos;ve seen
        </h3>
      </div>

      {state.status === "loading" && (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <div className="h-3 w-1/3 bg-slate-200 rounded animate-pulse" />
              <div className="mt-2 h-3 w-full bg-slate-200 rounded animate-pulse" />
              <div className="mt-2 h-3 w-4/5 bg-slate-200 rounded animate-pulse" />
            </li>
          ))}
        </ul>
      )}

      {state.status === "ready" && (
        <ul className="space-y-3">
          {state.reports.map((r) => (
            <li
              key={r.id}
              className="rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-gov-slate">
                <span className="capitalize">{metaLine(r)}</span>
                <span>{relativeTime(r.createdAt)}</span>
              </div>
              {r.scrubbedContent && (
                <p className="mt-2 text-sm text-deep-navy leading-snug">
                  {excerpt(r.scrubbedContent)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-gov-slate">
        Based on Australian community reports from the last 30 days. Personal
        details have been removed before storage.
      </p>
    </section>
  );
}
