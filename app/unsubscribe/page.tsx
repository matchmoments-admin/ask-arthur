"use client";

import { useState } from "react";
import Link from "next/link";
import Footer from "@/components/Footer";

export default function UnsubscribePage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setStatus("error");
        setErrorMsg(data.error || "Too many requests. Please try again later.");
        return;
      }

      if (!res.ok) {
        throw new Error("Failed to unsubscribe");
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. Please try again.");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="h-1.5 bg-deep-navy w-full" />

      <nav aria-label="Main navigation" className="w-full max-w-[640px] mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <Link href="/" className="text-deep-navy font-extrabold text-lg uppercase tracking-wide">
          Ask Arthur
        </Link>
      </nav>

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        <h1 className="text-deep-navy text-3xl font-extrabold mb-4">Unsubscribe</h1>
        <p className="text-gov-slate text-base leading-relaxed mb-8">
          Enter your email address below to unsubscribe from weekly scam alerts.
        </p>

        {status === "success" ? (
          <div className="bg-safe-bg border border-safe-border rounded-[4px] p-4 text-[#388E3C] text-base font-medium">
            You&apos;ve been unsubscribed. You won&apos;t receive any more emails from us.
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
              {status === "loading" ? "Unsubscribing..." : "Unsubscribe"}
            </button>

            {status === "error" && (
              <p className="text-danger-text text-sm">{errorMsg}</p>
            )}
          </form>
        )}
      </main>

      <Footer />
    </div>
  );
}
