"use client";

import { useState } from "react";

// Fires the monthly Clone Watch snapshot + trend backfill for a chosen month
// via /api/admin/clone-watch/backfill-summary (admin-gated). Async — the
// Inngest fn recomputes the summary + trend rows in the background.
export default function BackfillButton() {
  const [month, setMonth] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "queued" | "error">("idle");

  async function fire() {
    setState("sending");
    try {
      const res = await fetch("/api/admin/clone-watch/backfill-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(month ? { periodMonth: month } : {}),
      });
      setState(res.ok ? "queued" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1 text-[12px]"
        title="Month to backfill (blank = prior month)"
      />
      <button
        onClick={fire}
        disabled={state === "sending"}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-md disabled:opacity-50"
        style={{
          border: "1px solid var(--color-line)",
          background: "var(--color-surface)",
          color: "var(--color-ink-2)",
        }}
        title="Recompute the monthly summary + per-brand/registrar trend rows for the selected month"
      >
        {state === "sending"
          ? "Queuing…"
          : state === "queued"
            ? "Queued ✓"
            : state === "error"
              ? "Failed — retry"
              : "Backfill summary"}
      </button>
    </div>
  );
}
