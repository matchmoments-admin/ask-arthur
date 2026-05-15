"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

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
      window.location.reload();
    } catch (err) {
      setError(`Network error: ${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-xl border border-border-light bg-white p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <KeyRound size={22} className="text-deep-navy shrink-0 mt-1" />
        <div className="flex-1">
          <h2 className="font-semibold text-deep-navy">
            You need an invite code
          </h2>
          <p className="text-sm text-gov-slate mt-1 leading-relaxed">
            SIM-swap check is in private beta. If you received an invite code
            by email, enter it below to get access.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
        <label
          className="text-sm font-medium text-deep-navy"
          htmlFor="invite-code"
        >
          Invite code
        </label>
        <input
          id="invite-code"
          name="inviteCode"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          className="rounded-lg border border-border-light px-3 py-2.5 text-base font-mono focus:outline-none focus:ring-2 focus:ring-deep-navy"
          placeholder="e.g. arthur-sim-7K3F"
          aria-invalid={error ? "true" : "false"}
          aria-describedby={error ? "invite-error" : undefined}
        />
        {error ? (
          <p
            id="invite-error"
            role="alert"
            className="text-sm text-[#B71C1C]"
          >
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={submitting || code.trim().length < 4}
          className="rounded-lg bg-deep-navy px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-navy transition-colors"
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
