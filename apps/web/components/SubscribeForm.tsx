"use client";

import { useState } from "react";

export default function SubscribeForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) throw new Error("Failed");
      setStatus("success");
      setEmail("");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="mt-12">
      <h3 className="text-deep-navy text-lg font-bold uppercase tracking-wide mb-2">
        Get weekly scam alerts
      </h3>
      <p className="text-gov-slate text-base mb-4 leading-relaxed">
        Stay ahead of the latest scams — delivered to your inbox every Monday.
      </p>

      {status === "success" ? (
        <p className="text-[#388E3C] text-base font-medium">
          You&apos;re subscribed! Check your inbox on Mondays.
        </p>
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
            {status === "loading" ? "Subscribing..." : "Subscribe"}
          </button>
        </form>
      )}

      {status === "error" && (
        <p className="text-danger-text text-sm mt-2">
          Something went wrong. Please try again.
        </p>
      )}
    </section>
  );
}
