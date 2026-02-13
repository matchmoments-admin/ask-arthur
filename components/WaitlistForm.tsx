"use client";

import { useState } from "react";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [weeklyAlerts, setWeeklyAlerts] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          subscribedWeekly: weeklyAlerts,
          source: "homepage",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to join waitlist");
      }

      setStatus("success");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <section className="w-full max-w-[640px] mx-auto px-5 mt-20 pt-12 border-t border-border-light">
      <h2 className="text-deep-navy text-xl font-bold uppercase tracking-wide mb-3">
        Worried about a parent or grandparent falling for scams?
      </h2>
      <p className="text-gov-slate text-base mb-6 leading-relaxed">
        We&apos;re building automatic protection that monitors messages and alerts your
        family before they engage with scammers. Join the waitlist for early access.
      </p>

      {status === "success" ? (
        <div className="bg-safe-bg border border-safe-border rounded-[4px] p-4 text-[#388E3C] text-base font-medium">
          You&apos;re on the list! We&apos;ll let you know when Scam Shield for Families is ready.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            aria-label="Email address"
            className="w-full px-4 py-3 text-base border border-border-light rounded-[4px] bg-white focus:ring-action-teal focus:border-action-teal"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full py-4 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors disabled:opacity-50"
          >
            {status === "loading" ? "Joining..." : "Join Waitlist"}
          </button>

          <label className="flex items-center gap-2 text-sm text-gov-slate cursor-pointer">
            <input
              type="checkbox"
              checked={weeklyAlerts}
              onChange={(e) => setWeeklyAlerts(e.target.checked)}
              className="rounded border-border-light"
            />
            Also send me weekly scam alerts
          </label>

          {status === "error" && (
            <p className="text-danger-text text-sm">{errorMsg}</p>
          )}
        </form>
      )}
    </section>
  );
}
