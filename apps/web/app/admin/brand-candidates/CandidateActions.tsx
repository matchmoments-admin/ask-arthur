"use client";

import { useState, useTransition } from "react";
import { setCandidateStatus, type CandidateStatus } from "./actions";

const BTN: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--color-line-soft)",
  background: "var(--color-surface-2)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/**
 * Two buttons per candidate row — the entire point of this page. Client
 * component because a server component cannot own the pending/error state of
 * an optimistic-feeling action, and the queue is small enough (tens of rows)
 * that per-row interactivity costs nothing.
 */
export function CandidateActions({
  brandNormalized,
  status,
}: {
  brandNormalized: string;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const act = (next: CandidateStatus, note: string) => {
    setError(null);
    startTransition(async () => {
      const res = await setCandidateStatus(brandNormalized, next, note);
      if (!res.ok) {
        setError(res.error ?? "failed");
        return;
      }
      // changed === 0 means the RPC matched nothing — an unknown brand or one
      // already in this state. Say so rather than showing a false success.
      setDone(res.changed === 0 ? "no change" : next);
    });
  };

  const current = done ?? status;

  if (current === "dismissed" || current === "reviewed" || current === "promoted") {
    return (
      <span style={{ fontSize: 12, color: "var(--color-muted)" }}>
        {current}
        {error ? ` · ${error}` : ""}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        style={BTN}
        disabled={pending}
        onClick={() => act("reviewed", "Marked worth monitoring from the admin queue.")}
        title="Worth monitoring — keeps it in the queue as decided, pending domain resolution"
      >
        Worth monitoring
      </button>
      <button
        type="button"
        style={BTN}
        disabled={pending}
        onClick={() => act("dismissed", "Dismissed from the admin queue.")}
        title="Not relevant to an AU clone-watch list"
      >
        Dismiss
      </button>
      {pending && <span style={{ fontSize: 12, color: "var(--color-muted)" }}>…</span>}
      {error && <span style={{ fontSize: 12, color: "#b91c1c" }}>{error}</span>}
      {done === "no change" && (
        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>no change</span>
      )}
    </span>
  );
}
