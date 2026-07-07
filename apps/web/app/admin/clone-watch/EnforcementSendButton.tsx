"use client";

import { useState } from "react";

/**
 * Four-eyes approve+send for a human-gated registrar/host abuse case. A
 * domain-level takedown report only goes out on an explicit click + confirm
 * (itch.io invariant). Posts to /api/admin/clone-watch/enforcement/send.
 */
export default function EnforcementSendButton({ caseId }: { caseId: number }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [msg, setMsg] = useState("");

  async function send() {
    if (
      !window.confirm(
        "Send this domain-level abuse report to the registrar/host? This is an outbound report to a third party — confirm the evidence is correct.",
      )
    ) {
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/admin/clone-watch/enforcement/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, confirm: true }),
      });
      if (res.ok) {
        setState("sent");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setState("error");
      setMsg(body.error ?? `HTTP ${res.status}`);
    } catch {
      setState("error");
      setMsg("network_error");
    }
  }

  if (state === "sent") {
    return <span style={{ color: "#137333" }}>sent ✓</span>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="rounded px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
        style={{ border: "1px solid var(--color-line)", background: "var(--color-surface)" }}
      >
        {state === "sending" ? "Sending…" : "Send"}
      </button>
      {state === "error" && (
        <span style={{ color: "#c5221f" }} className="text-[11px]">
          {msg}
        </span>
      )}
    </span>
  );
}
