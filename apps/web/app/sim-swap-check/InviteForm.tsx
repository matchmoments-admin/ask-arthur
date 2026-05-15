"use client";

import { useState } from "react";

export function InviteForm({ prefilledCode }: { prefilledCode: string }) {
  const [code, setCode] = useState(prefilledCode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/sim-swap/invites/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode: code.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(errorMessage(body.error, res.status));
        return;
      }
      // Reload to re-render the page in the in-beta state.
      window.location.reload();
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-stone-50 p-6">
      <h2 className="text-lg font-medium">You need an invite code</h2>
      <p className="mt-2 text-sm text-stone-600">
        SIM-swap check is in private beta. If you received an invite code by
        email, enter it below to get access.
      </p>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="invite-code">
          Invite code
        </label>
        <input
          id="invite-code"
          name="inviteCode"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          className="rounded-md border border-stone-300 px-3 py-2 text-base font-mono"
          placeholder="e.g. arthur-sim-7K3F"
        />
        {error ? (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || code.trim().length < 4}
          className="rounded-md bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Redeeming…" : "Redeem invite"}
        </button>
      </form>
    </section>
  );
}

function errorMessage(code: string | undefined, status: number): string {
  switch (code) {
    case "invite_not_found":
      return "That invite code wasn't recognised. Double-check it matches the email exactly.";
    case "invite_already_used":
      return "That invite has already been redeemed by another account.";
    case "feature_disabled":
      return "The SIM-swap check feature isn't enabled yet.";
    case "unauthenticated":
      return "Please sign in first.";
    default:
      return `Couldn't redeem (HTTP ${status}). Try again or contact support.`;
  }
}
