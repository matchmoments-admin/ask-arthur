"use client";

import { useState, useTransition } from "react";
import {
  demoteCandidate,
  promoteCandidate,
  setCandidateStatus,
  type CandidateStatus,
} from "./actions";

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
  brandName,
  status,
}: {
  brandNormalized: string;
  brandName: string;
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

  const promote = () => {
    setError(null);
    // The domain is typed, never inferred. legitimate_domains is the matcher's
    // EXCLUSION list: a squatter-held <brand>.com.au recorded as legitimate is
    // exactly the domain we would then stop reporting as a clone.
    const domains = window.prompt(
      `Official domain(s) for ${brandName}, comma-separated.\n\n` +
        `This is the matcher's EXCLUSION list — it is what stops the brand's ` +
        `own site being reported as a clone of itself. Get it right or leave ` +
        `it unpromoted.`,
      "",
    );
    if (domains === null) return; // cancelled
    if (!domains.trim()) {
      setError("a domain is required");
      return;
    }
    startTransition(async () => {
      const res = await promoteCandidate(brandNormalized, brandName, domains);
      if (!res.ok) {
        setError(res.error ?? "failed");
        return;
      }
      setDone("promoted");
    });
  };

  const undo = () => {
    setError(null);
    startTransition(async () => {
      const res = await demoteCandidate(brandNormalized);
      if (!res.ok) {
        setError(res.error ?? "failed");
        return;
      }
      setDone("pending");
    });
  };

  const current = done ?? status;

  // A promoted brand is live in the matcher, so the undo has to be right here
  // rather than in a runbook.
  if (current === "promoted") {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--color-ink-2)", fontWeight: 600 }}>
          promoted
        </span>
        <button type="button" style={BTN} disabled={pending} onClick={undo}>
          Undo
        </button>
        {error && <span style={{ fontSize: 12, color: "#b91c1c" }}>{error}</span>}
      </span>
    );
  }

  // Dismissed / reviewed used to render as dead text with no controls, so a
  // misclick was unrecoverable from this page — the only surface that shows
  // these rows. That asymmetry was the trap: `promoted` (the consequential,
  // writes-to-the-live-matcher action) had an Undo, while `dismissed` (the
  // cheap one an operator does in bulk down a list) did not. Reversing a
  // triage decision needs no domain and touches nothing live, so there is no
  // reason for it to require an engineer with SQL access.
  if (current === "dismissed" || current === "reviewed") {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--color-muted)" }}>{current}</span>
        <button
          type="button"
          style={BTN}
          disabled={pending}
          onClick={() =>
            act("pending", `Returned to pending from '${current}' in the admin queue.`)
          }
          title="Put this brand back in the pending queue"
        >
          Undo
        </button>
        {pending && <span style={{ fontSize: 12, color: "var(--color-muted)" }}>…</span>}
        {error && <span style={{ fontSize: 12, color: "#b91c1c" }}>{error}</span>}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        style={{ ...BTN, fontWeight: 600 }}
        disabled={pending}
        onClick={promote}
        title="Add to the live matcher watchlist — requires the official domain(s)"
      >
        Promote
      </button>
      <button
        type="button"
        style={BTN}
        disabled={pending}
        onClick={() => act("reviewed", "Marked worth monitoring from the admin queue.")}
        title="Worth monitoring, but not promoting yet"
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
