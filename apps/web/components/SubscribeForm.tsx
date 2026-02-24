"use client";

import { useState } from "react";

interface SubscribeFormProps {
  variant?: "default" | "inline";
}

export default function SubscribeForm({ variant = "default" }: SubscribeFormProps) {
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

  if (status === "success") {
    return (
      <p className="text-[#388E3C] text-base font-medium">
        You&apos;re subscribed! Check your inbox on Mondays.
      </p>
    );
  }

  if (variant === "inline") {
    return (
      <div>
        <form onSubmit={handleSubmit} className="flex items-center gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            aria-label="Email address"
            className="flex-1 px-4 py-2.5 text-sm border border-border-light rounded-[4px] bg-white focus:ring-action-teal focus:border-action-teal"
          />
          <button
            type="submit"
            disabled={status === "loading"}
            className="py-2.5 px-6 bg-deep-navy text-white font-bold text-xs uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {status === "loading" ? "Subscribing..." : "Subscribe"}
          </button>
        </form>
        {status === "error" && (
          <p className="text-danger-text text-sm mt-2">
            Something went wrong. Please try again.
          </p>
        )}
      </div>
    );
  }

  return (
    <section className="mt-12">
      <h3 className="text-deep-navy text-lg font-bold uppercase tracking-wide mb-2">
        Get weekly scam alerts
      </h3>
      <p className="text-gov-slate text-base mb-4 leading-relaxed">
        Stay ahead of the latest scams — delivered to your inbox every Monday.
      </p>

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
          className="w-full py-3 bg-deep-navy text-white font-bold text-xs uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors disabled:opacity-50"
        >
          {status === "loading" ? "Subscribing..." : "Subscribe"}
        </button>
      </form>

      {status === "error" && (
        <p className="text-danger-text text-sm mt-2">
          Something went wrong. Please try again.
        </p>
      )}
    </section>
  );
}
