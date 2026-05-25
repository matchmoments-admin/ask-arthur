"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, XCircle, Search, ExternalLink, Copy } from "lucide-react";

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
}

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
}: {
  initialPending: PendingAlert[];
}) {
  const [pending, setPending] = useState(initialPending);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleTriage = (alertId: number, status: TriageStatus) => {
    setError(null);
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

  if (pending.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm bg-white border border-border-light rounded-xl">
        Nothing awaiting triage. The next NRD ingest runs at 08:30 UTC.
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="mb-4 px-4 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg">
          {error}
        </div>
      )}
      <div className="bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Search size={14} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-deep-navy">
            Pending — {pending.length}
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
            />
          ))}
        </div>
      </div>
    </>
  );
}

function PendingRow({
  row,
  disabled,
  onTriage,
}: {
  row: PendingAlert;
  disabled: boolean;
  onTriage: (id: number, status: TriageStatus) => void;
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

  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-deep-navy">
              {row.candidate_domain}
            </span>
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
              {signalType}
            </span>
            <span className="text-[10px] text-slate-400">score {score}</span>
          </div>
          <p className="text-xs text-slate-500">
            <span className="text-slate-400">matches</span>{" "}
            <span className="font-medium">{row.inferred_target_domain}</span>
            {evidence && <span className="text-slate-400"> · {evidence}</span>}
          </p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            first seen {new Date(row.first_seen_at).toLocaleString("en-AU")}
          </p>
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
              title="urlscan.io sandbox lookup (safe to open)"
            >
              <ExternalLink size={11} />
              urlscan
            </a>
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
