"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  XCircle,
  Search,
  ExternalLink,
  Copy,
  Camera,
  RefreshCw,
  Send,
  Mail,
} from "lucide-react";

export interface PendingAlert {
  id: number;
  inferred_target_domain: string;
  candidate_domain: string;
  candidate_url: string;
  signals: Array<{
    type?: string;
    score?: number;
    signal_type?: string;
    evidence?: Record<string, string | number>;
  }>;
  severity_tier: string;
  triage_status: string;
  first_seen_at: string;
  // From v148 — urlscan auto-scan evidence. Nullable while flag is OFF
  // or scan hasn't fired yet.
  urlscan_classification?:
    | "parked_for_sale"
    | "unresolved"
    | "likely_phishing"
    | "neutral"
    | null;
  urlscan_scanned_at?: string | null;
  urlscan_screenshot_url?: string | null;
  urlscan_effective_url?: string | null;
}

export interface PendingBatch {
  batchId: string;
  brand: string;
  recipient: string;
  subject: string;
  candidateCount: number;
  candidateDomains: string[];
  preparedAt: string;
}

const URLSCAN_LABEL: Record<
  NonNullable<PendingAlert["urlscan_classification"]>,
  string
> = {
  parked_for_sale: "parked",
  unresolved: "unresolved",
  likely_phishing: "likely phishing",
  neutral: "resolves",
};

const URLSCAN_STYLE: Record<
  NonNullable<PendingAlert["urlscan_classification"]>,
  string
> = {
  parked_for_sale: "bg-amber-50 text-amber-700 border-amber-200",
  unresolved: "bg-slate-50 text-slate-600 border-slate-200",
  likely_phishing: "bg-rose-100 text-rose-800 border-rose-300 font-semibold",
  neutral: "bg-sky-50 text-sky-700 border-sky-200",
};

type TriageStatus = "tp_confirmed" | "fp" | "needs_investigation";

const STATUS_LABEL: Record<TriageStatus, string> = {
  tp_confirmed: "TP — confirm clone",
  fp: "FP — drop",
  needs_investigation: "Investigate",
};

const STATUS_STYLE: Record<TriageStatus, string> = {
  tp_confirmed:
    "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
  fp: "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100",
  needs_investigation:
    "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
};

export default function CloneWatchTriage({
  initialPending,
  initialPendingBatches,
}: {
  initialPending: PendingAlert[];
  initialPendingBatches: PendingBatch[];
}) {
  const [pending, setPending] = useState(initialPending);
  const [pendingBatches, setPendingBatches] = useState(initialPendingBatches);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Separate info channel — success / "scan queued" / acknowledgement
  // messages. setError() is reserved for actual errors so the styling
  // matches the message intent (red vs blue). Fixes ultrareview F10.
  const [info, setInfo] = useState<string | null>(null);

  const handleBatchAction = (
    batchId: string,
    action: "send" | "reject",
  ) => {
    setError(null);
    setInfo(null);
    const previous = pendingBatches;
    const batch = pendingBatches.find((b) => b.batchId === batchId);
    setPendingBatches((rows) => rows.filter((r) => r.batchId !== batchId));

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/clone-watch/batches/${encodeURIComponent(batchId)}/${action}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(
            j.error ?? `${action} failed (${res.status})`,
          );
        }
        if (action === "send" && batch) {
          setInfo(
            `Sent email to ${batch.recipient} (${batch.candidateCount} candidate${batch.candidateCount === 1 ? "" : "s"})`,
          );
        } else if (action === "reject" && batch) {
          setInfo(`Batch for ${batch.brand} rejected. No email sent.`);
        }
      } catch (err) {
        setPendingBatches(previous);
        setError(err instanceof Error ? err.message : `${action} failed`);
      }
    });
  };

  const handleTriage = (alertId: number, status: TriageStatus) => {
    setError(null);
    setInfo(null);
    const previous = pending;
    setPending((rows) => rows.filter((r) => r.id !== alertId));

    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/clone-watch/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId, status }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `triage failed (${res.status})`);
        }
      } catch (err) {
        setPending(previous);
        setError(err instanceof Error ? err.message : "triage failed");
      }
    });
  };

  const handleScan = (alertId: number) => {
    setError(null);
    setInfo(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/clone-watch/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alertId }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? `scan request failed (${res.status})`);
        }
        // No optimistic update — scan completes async (~90s). The row's
        // urlscan_classification + screenshot will land on the next page
        // load.
        setInfo(
          `Scan queued for alert ${alertId} — refresh in ~90s to see the result`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "scan request failed");
      }
    });
  };

  const empty = pending.length === 0 && pendingBatches.length === 0;

  return (
    <>
      {error && (
        <div className="mb-4 px-4 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">
          {error}
        </div>
      )}
      {info && (
        <div className="mb-4 px-4 py-2 bg-sky-50 border border-sky-200 text-sky-700 text-sm rounded-lg">
          {info}
        </div>
      )}

      <div id="approvals" />
      {pendingBatches.length > 0 && (
        <div className="mb-6 bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Mail size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-deep-navy">
              Pending brand-notification approvals — {pendingBatches.length}
            </h2>
            <span className="ml-auto text-[11px] text-slate-400">
              Oldest first
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {pendingBatches.map((batch) => (
              <PendingBatchRow
                key={batch.batchId}
                batch={batch}
                disabled={isPending}
                onAction={handleBatchAction}
              />
            ))}
          </div>
        </div>
      )}

      {empty && (
        <div className="text-center py-16 text-slate-400 text-sm bg-white border border-border-light rounded-xl">
          Nothing awaiting triage or approval. The next NRD ingest runs at
          08:30 UTC; the next brand-notification prepare runs at 09:30 UTC.
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <Search size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-deep-navy">
              Pending triage — {pending.length}
            </h2>
            <span className="ml-auto text-[11px] text-slate-400">
              Newest first
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {pending.map((row) => (
              <PendingRow
                key={row.id}
                row={row}
                disabled={isPending}
                onTriage={handleTriage}
                onScan={handleScan}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function PendingBatchRow({
  batch,
  disabled,
  onAction,
}: {
  batch: PendingBatch;
  disabled: boolean;
  onAction: (batchId: string, action: "send" | "reject") => void;
}) {
  const preparedAge = formatAge(batch.preparedAt);
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-sm font-semibold text-deep-navy">
              {batch.brand}
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              {batch.candidateCount} candidate
              {batch.candidateCount === 1 ? "" : "s"}
            </span>
            <span className="text-[10px] text-slate-400">{preparedAge}</span>
          </div>
          <p className="text-xs text-slate-600 mb-1">
            <span className="text-slate-400">to</span>{" "}
            <code className="text-[12px] bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
              {batch.recipient}
            </code>
          </p>
          <p className="text-xs text-slate-700 mb-2">
            <span className="text-slate-400">subject</span> {batch.subject}
          </p>
          <p className="text-[11px] text-slate-500 break-all">
            {batch.candidateDomains.slice(0, 8).join(" · ")}
            {batch.candidateDomains.length > 8 && (
              <> &middot; …+{batch.candidateDomains.length - 8} more</>
            )}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction(batch.batchId, "send")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100 text-xs font-semibold disabled:opacity-50"
          >
            <Send size={12} />
            Send
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction(batch.batchId, "reject")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 text-xs font-semibold disabled:opacity-50"
          >
            <XCircle size={12} />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PendingRow({
  row,
  disabled,
  onTriage,
  onScan,
}: {
  row: PendingAlert;
  disabled: boolean;
  onTriage: (id: number, status: TriageStatus) => void;
  onScan: (id: number) => void;
}) {
  const signal = row.signals?.[0];
  const signalType = signal?.signal_type ?? signal?.type ?? "unknown";
  const score =
    typeof signal?.score === "number"
      ? signal.score.toFixed(2)
      : "—";
  const evidence = signal?.evidence
    ? Object.entries(signal.evidence)
        .map(([k, v]) => `${k}=${v}`)
        .join(" · ")
    : "";

  const sandboxUrl = `https://urlscan.io/search/#domain%3A${encodeURIComponent(row.candidate_domain)}`;
  const hasUrlscan = Boolean(row.urlscan_classification);

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex gap-3">
          {isHttpsUrlscanUrl(row.urlscan_screenshot_url) && (
            // Thumbnail of the rendered page so the operator can eyeball
            // whether it looks like a phishing page without opening the
            // candidate URL directly. urlscan-hosted CDN.
            // Defense-in-depth (ultrareview F19): we validate the URL is
            // an https://urlscan.io path before rendering, even though
            // CSP would block anything else.
            // referrerPolicy="no-referrer" prevents leaking the admin
            // dashboard URL to the CDN (ultrareview F3).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.urlscan_screenshot_url!}
              alt={`Sandbox screenshot of ${row.candidate_domain}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-32 h-20 object-cover object-top border border-slate-200 rounded shadow-sm shrink-0"
            />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-sm font-semibold text-deep-navy">
                {row.candidate_domain}
              </span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                {signalType}
              </span>
              <span className="text-[10px] text-slate-400">score {score}</span>
              {row.urlscan_classification && (
                <span
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${URLSCAN_STYLE[row.urlscan_classification]}`}
                  title={
                    row.urlscan_effective_url
                      ? `urlscan effective URL: ${row.urlscan_effective_url}`
                      : undefined
                  }
                >
                  {URLSCAN_LABEL[row.urlscan_classification]}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">matches</span>{" "}
              <span className="font-medium">{row.inferred_target_domain}</span>
              {evidence && <span className="text-slate-400"> · {evidence}</span>}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              first seen {new Date(row.first_seen_at).toLocaleString("en-AU")}
              {row.urlscan_scanned_at && (
                <>
                  {" · "}
                  urlscan{" "}
                  {new Date(row.urlscan_scanned_at).toLocaleString("en-AU")}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                navigator.clipboard?.writeText(row.candidate_url)
              }
              className="text-[11px] flex items-center gap-1 px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
              title="Copy candidate URL"
            >
              <Copy size={11} />
              Copy URL
            </button>
            <a
              href={sandboxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] flex items-center gap-1 px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 text-slate-600"
              title="urlscan.io public search (safe to open)"
            >
              <ExternalLink size={11} />
              urlscan
            </a>
            <button
              type="button"
              onClick={() => onScan(row.id)}
              disabled={disabled}
              className="text-[11px] flex items-center gap-1 px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 text-slate-600 disabled:opacity-40"
              title={
                hasUrlscan
                  ? "Re-scan via urlscan.io (overwrites the previous result in ~90s)"
                  : "Scan via urlscan.io (result lands in ~90s)"
              }
            >
              {hasUrlscan ? (
                <>
                  <RefreshCw size={11} />
                  Re-scan
                </>
              ) : (
                <>
                  <Camera size={11} />
                  Scan now
                </>
              )}
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <TriageButton
              status="tp_confirmed"
              icon={<CheckCircle2 size={12} />}
              disabled={disabled}
              onClick={() => onTriage(row.id, "tp_confirmed")}
            />
            <TriageButton
              status="needs_investigation"
              icon={<Search size={12} />}
              disabled={disabled}
              onClick={() => onTriage(row.id, "needs_investigation")}
            />
            <TriageButton
              status="fp"
              icon={<XCircle size={12} />}
              disabled={disabled}
              onClick={() => onTriage(row.id, "fp")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function isHttpsUrlscanUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith("urlscan.io");
  } catch {
    return false;
  }
}

function TriageButton({
  status,
  icon,
  disabled,
  onClick,
}: {
  status: TriageStatus;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] flex items-center gap-1 px-2.5 py-1 border rounded transition-colors disabled:opacity-40 ${STATUS_STYLE[status]}`}
    >
      {icon}
      {STATUS_LABEL[status]}
    </button>
  );
}
