"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Mail, Search, Send, XCircle } from "lucide-react";
import TriageRow, {
  type PendingAlertView,
} from "@/components/admin/triage/TriageRow";
import BulkActionBar from "@/components/admin/triage/BulkActionBar";
import BrandGroupHeader from "@/components/admin/triage/BrandGroupHeader";
import type { TriageStatus } from "@/components/admin/triage/types";

// Re-export the alert shape under its prior name for the server-side
// `page.tsx` callers. The new TriageRow consumes the same shape.
export type PendingAlert = PendingAlertView;

// sessionStorage key for bulk-selection persistence. Scoped to the
// browser tab (not localStorage) — we want selection to survive
// page refresh + navigation around the admin chrome, but not bleed
// into a future session a week later. Stale IDs (rows another admin
// triaged in the meantime) are filtered against the current pending
// list on hydration.
const SELECTION_STORAGE_KEY = "admin:clone-watch:selection";

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
  // Bulk-selection: a Set of pending alert ids the admin has ticked.
  // Empty by default; cleared after any bulk action.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  // Hydrate selection from sessionStorage on mount. Filtered against the
  // current pending list so stale IDs (rows another admin or a previous
  // session triaged) don't reappear. Runs once on mount — re-running on
  // `pending` change would cause selection drift when rows are added
  // mid-session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(SELECTION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const pendingIds = new Set(initialPending.map((r) => r.id));
      const hydrated = parsed.filter(
        (id): id is number => typeof id === "number" && pendingIds.has(id),
      );
      if (hydrated.length > 0) {
        setSelectedIds(new Set(hydrated));
      }
    } catch {
      // Corrupt storage value — ignore. Worst case: admin re-selects.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only hydration
  }, []);

  // Persist selection on every change. Cleared when the set is empty so
  // a stale entry doesn't survive a tab restore.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (selectedIds.size === 0) {
        window.sessionStorage.removeItem(SELECTION_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(
          SELECTION_STORAGE_KEY,
          JSON.stringify(Array.from(selectedIds)),
        );
      }
    } catch {
      // sessionStorage can throw in Safari private mode + quota-exceeded.
      // Silent — selection just doesn't persist; the in-memory state
      // continues to work.
    }
  }, [selectedIds]);

  // Group pending rows by inferred_target_domain, preserving the parent
  // order. Any group of ≥2 gets a BrandGroupHeader with "Select all N"
  // affordance (the only place the user-requested per-brand grouping
  // surfaces in UI — alerts in groups of 1 render as plain rows).
  const pendingGroups = useMemo(() => {
    const groups = new Map<string, PendingAlert[]>();
    for (const row of pending) {
      const key = row.inferred_target_domain;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    return Array.from(groups.entries()).map(([brand, rows]) => ({
      brand,
      rows,
      ids: rows.map((r) => r.id),
    }));
  }, [pending]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectGroup = (ids: number[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkTriage = (status: TriageStatus) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setError(null);
    setInfo(null);
    // Optimistic flip — drop the selected rows + clear selection now.
    // On any failure we restore the affected rows (the ones whose POST
    // did not return ok).
    const previous = pending;
    setPending((rows) => rows.filter((r) => !selectedIds.has(r.id)));
    clearSelection();

    startTransition(async () => {
      const results = await Promise.allSettled(
        ids.map((alertId) =>
          fetch("/api/admin/clone-watch/triage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alertId, status }),
          }).then(async (res) => {
            const body = res.ok
              ? ((await res.json().catch(() => ({}))) as {
                  eventEmitted?: boolean;
                })
              : null;
            return {
              alertId,
              ok: res.ok,
              status: res.status,
              eventEmitted: body?.eventEmitted ?? true,
            };
          }),
        ),
      );
      const failed: number[] = [];
      let eventDrops = 0;
      for (const r of results) {
        if (r.status === "rejected" || !r.value.ok) {
          failed.push(
            r.status === "fulfilled"
              ? r.value.alertId
              : 0, // network throw — we lose the id but the count is still right below
          );
        } else if (status === "tp_confirmed" && r.value.eventEmitted === false) {
          eventDrops++;
        }
      }
      if (failed.length === 0) {
        if (eventDrops > 0) {
          setError(
            `Triage saved for ${ids.length}, but ${eventDrops} downstream fan-out${eventDrops === 1 ? "" : "s"} dropped (no Netcraft / brand-notify). Re-triage those rows to retry.`,
          );
        } else {
          setInfo(
            `Bulk action applied to ${ids.length} alert${ids.length === 1 ? "" : "s"}`,
          );
        }
      } else {
        // Restore the failed rows from the snapshot
        const failedSet = new Set(failed);
        const failedRows = previous.filter((r) => failedSet.has(r.id));
        setPending((current) => [...failedRows, ...current]);
        setError(
          `${failed.length} of ${ids.length} alerts failed to update — restored. The rest succeeded.`,
        );
      }
    });
  };

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
        // Triage succeeded but if the downstream Inngest event failed
        // (rare — defended by server-side 3-attempt retry), the alert
        // is marked tp_confirmed but no Netcraft / brand-notify fires.
        // Surface so the operator can re-triage manually.
        const body = (await res.json().catch(() => ({}))) as {
          eventEmitted?: boolean;
        };
        if (status === "tp_confirmed" && body.eventEmitted === false) {
          setError(
            `Triage saved but downstream fan-out failed (no Netcraft / brand-notify). Re-triage by setting to Park then back to Confirm clone.`,
          );
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
          <div style={{ paddingBottom: selectedIds.size > 0 ? 80 : 0 }}>
            {pendingGroups.map((group) => {
              const showHeader = group.rows.length >= 2;
              const allSelected =
                group.rows.length > 0 &&
                group.ids.every((id) => selectedIds.has(id));
              return (
                <div key={group.brand}>
                  {showHeader && (
                    <BrandGroupHeader
                      brand={group.brand}
                      count={group.rows.length}
                      allSelected={allSelected}
                      onToggleAll={() => toggleSelectGroup(group.ids)}
                    />
                  )}
                  {group.rows.map((row) => (
                    <TriageRow
                      key={row.id}
                      row={row}
                      disabled={isPending}
                      onTriage={handleTriage}
                      onScan={handleScan}
                      selected={selectedIds.has(row.id)}
                      onToggleSelect={() => toggleSelect(row.id)}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <BulkActionBar
        count={selectedIds.size}
        disabled={isPending}
        onConfirmAll={() => handleBulkTriage("tp_confirmed")}
        onInvestigateAll={() => handleBulkTriage("needs_investigation")}
        onDismissAll={() => handleBulkTriage("fp")}
        onClear={clearSelection}
      />
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
