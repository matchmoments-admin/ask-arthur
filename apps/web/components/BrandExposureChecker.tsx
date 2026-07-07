"use client";

import { useState } from "react";

import CloneListRequestForm from "@/components/CloneListRequestForm";

interface Example {
  masked: string;
  classification: string | null;
  first_seen: string;
}

interface Teaser {
  monitored: boolean;
  brand?: string;
  count: number;
  earliest?: string | null;
  examples: Example[];
}

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "result"; teaser: Teaser }
  | { kind: "error"; message: string };

export default function BrandExposureChecker() {
  const [brand, setBrand] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const q = brand.trim();
    if (!q) return;
    setState({ kind: "checking" });
    try {
      const res = await fetch("/api/brand-exposure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand: q }),
      });
      if (res.status === 429) {
        setState({ kind: "error", message: "Too many checks — try again shortly." });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: "Something went wrong. Try again." });
        return;
      }
      setState({ kind: "result", teaser: (await res.json()) as Teaser });
    } catch {
      setState({ kind: "error", message: "Network error. Try again." });
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={check} className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          placeholder="Your brand name or domain (e.g. Target, qantas.com.au)"
          aria-label="Brand name or domain"
          className="flex-1 rounded-md border px-4 py-3 text-sm"
          style={{ borderColor: "var(--color-line)" }}
        />
        <button
          type="submit"
          disabled={state.kind === "checking" || !brand.trim()}
          className="rounded-md px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--color-deep-navy, #0b2545)" }}
        >
          {state.kind === "checking" ? "Checking…" : "Check exposure"}
        </button>
      </form>

      {state.kind === "error" && (
        <p className="mt-4 text-sm text-red-600">{state.message}</p>
      )}

      {state.kind === "result" && !state.teaser.monitored && (
        <div className="mt-6 rounded-lg border p-5" style={{ borderColor: "var(--color-line)" }}>
          <p className="text-deep-navy text-sm font-semibold">
            We&apos;re not monitoring that brand yet.
          </p>
          <p className="text-gov-slate mt-1 text-sm">
            We track lookalike domains for a curated set of Australian brands. Want
            yours added? Request monitoring below and we&apos;ll be in touch.
          </p>
          <div className="mt-4">
            <CloneListRequestForm defaultBrand={brand.trim()} />
          </div>
        </div>
      )}

      {state.kind === "result" && state.teaser.monitored && (
        <div className="mt-6 rounded-lg border p-5" style={{ borderColor: "var(--color-line)" }}>
          {state.teaser.count === 0 ? (
            <p className="text-deep-navy text-sm font-semibold">
              Good news — no confirmed lookalikes for {state.teaser.brand} in our
              current window. We keep watching daily.
            </p>
          ) : (
            <>
              <p className="text-deep-navy text-base font-bold">
                We&apos;ve detected {state.teaser.count} suspected lookalike domain
                {state.teaser.count === 1 ? "" : "s"} impersonating{" "}
                {state.teaser.brand}.
              </p>
              <p className="text-gov-slate mt-1 text-sm">
                A sample (domains masked until you request the full list):
              </p>
              <ul className="mt-3 space-y-1">
                {state.teaser.examples.map((ex) => (
                  <li key={ex.masked} className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{ex.masked}</span>
                    {ex.classification === "likely_phishing" && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                        likely phishing
                      </span>
                    )}
                    <span className="text-gov-slate text-[11px]">
                      first seen {ex.first_seen}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
                <p className="text-deep-navy mb-2 text-sm font-semibold">
                  Get the full unmasked list (work email)
                </p>
                <CloneListRequestForm defaultBrand={state.teaser.brand ?? brand.trim()} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
