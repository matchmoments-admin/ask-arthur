"use client";

import { useState, useTransition } from "react";
import { Mail, Search, Send, XCircle } from "lucide-react";
import TriageRow, {
  type PendingAlertView,
} from "@/components/admin/triage/TriageRow";
import type { TriageStatus } from "@/components/admin/triage/types";

// Re-export the alert shape under its prior name for the server-side
// `page.tsx` callers. The new TriageRow consumes the same shape.
export type PendingAlert = PendingAlertView;

export interface PendingBatch {
  batchId: string;
  brand: string;
  recipient: string;
  subject: string;
  candidateCount: number;
  candidateDomains: string[];
  preparedAt: string;
}

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

  const handleBatchAction = (batchId: string, action: "send" | "reject") => {
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
          throw new Error(j.error ?? `${action} failed (${res.status})`);
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
        <div
          className="mb-4 px-4 py-2.5 rounded-xl text-[13px]"
          style={{
            background: "var(--color-tp-bg)",
            border: "1px solid var(--color-tp-ring)",
            color: "var(--color-tp-fg)",
          }}
        >
          {error}
        </div>
      )}
      {info && (
        <div
          className="mb-4 px-4 py-2.5 rounded-xl text-[13px]"
          style={{
            background: "#EEF2F8",
            border: "1px solid #DDE2EA",
            color: "#1B3257",
          }}
        >
          {info}
        </div>
      )}

      <div id="approvals" />
      {pendingBatches.length > 0 && (
        <div
          className="mb-6 overflow-hidden"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="flex items-center gap-2"
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid var(--color-line-soft)",
            }}
          >
            <Mail size={14} className="text-[var(--color-muted)]" />
            <h2
              className="serif text-[15px]"
              style={{ color: "var(--color-ink)" }}
            >
              Pending brand-notification approvals
            </h2>
            <span
              className="font-semibold rounded-full text-white"
              style={{
                fontSize: 11,
                padding: "1px 7px",
                background: "var(--color-ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {pendingBatches.length}
            </span>
            <span
              className="ml-auto text-[11px]"
              style={{ color: "var(--color-muted-2)" }}
            >
              Oldest first
            </span>
          </div>
          <div>
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
        <div
          className="text-center"
          style={{
            padding: "48px 16px",
            color: "var(--color-muted-2)",
            fontSize: 13,
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
          }}
        >
          Nothing awaiting triage or approval. The next NRD ingest runs at
          08:30 UTC; the next brand-notification prepare runs at 09:30 UTC.
        </div>
      )}

      {pending.length > 0 && (
        <div
          className="overflow-hidden"
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: 14,
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="flex items-center gap-2 sticky top-0 z-[5]"
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--color-line)",
              background: "var(--color-surface)",
            }}
          >
            <Search size={15} className="text-[var(--color-muted)]" />
            <h2
              className="serif text-[15px]"
              style={{ color: "var(--color-ink)" }}
            >
              Pending triage
            </h2>
            <span
              className="font-semibold rounded-full text-white"
              style={{
                fontSize: 11,
                padding: "1px 7px",
                background: "var(--color-ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {pending.length}
            </span>
            <span
              className="ml-auto text-[11px]"
              style={{ color: "var(--color-muted-2)" }}
            >
              Newest first
            </span>
          </div>
          <div>
            {pending.map((row) => (
              <TriageRow
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
    <div style={{ padding: "16px 16px" }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="serif text-[15px]"
              style={{ color: "var(--color-ink)" }}
            >
              {batch.brand}
            </span>
            <span
              className="uppercase tracking-wider"
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                background: "#EEF2F8",
                color: "#1B3257",
              }}
            >
              {batch.candidateCount} candidate
              {batch.candidateCount === 1 ? "" : "s"}
            </span>
            <span
              className="text-[10px]"
              style={{ color: "var(--color-muted-2)" }}
            >
              {preparedAge}
            </span>
          </div>
          <p className="text-[12px] mb-1" style={{ color: "var(--color-muted)" }}>
            <span style={{ color: "var(--color-muted-2)" }}>to</span>{" "}
            <code
              className="mono"
              style={{
                fontSize: 12,
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-line)",
                color: "var(--color-ink-2)",
              }}
            >
              {batch.recipient}
            </code>
          </p>
          <p
            className="text-[12px] mb-2"
            style={{ color: "var(--color-ink-2)" }}
          >
            <span style={{ color: "var(--color-muted-2)" }}>subject</span>{" "}
            {batch.subject}
          </p>
          <p
            className="text-[11px] break-all"
            style={{ color: "var(--color-muted)" }}
          >
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
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-teal)",
              background: "var(--color-teal-soft)",
              color: "var(--color-teal)",
            }}
          >
            <Send size={12} />
            Send
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAction(batch.batchId, "reject")}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold disabled:opacity-50"
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-tp-ring)",
              background: "var(--color-tp-bg)",
              color: "var(--color-tp-fg)",
            }}
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
