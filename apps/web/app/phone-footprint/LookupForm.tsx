"use client";

// Client-side lookup form for the landing page. POSTs (actually GETs) to
// /api/phone-footprint/[msisdn] and renders the returned footprint
// in-place — no separate navigation step for first-time users.
//
// Turnstile flow is simplified for Sprint 2: we retry the request with
// a fresh Turnstile token if the API returns 428 precondition_required.
// Full Turnstile widget integration comes in Sprint 3 when we have a
// real abuse-prone UX to defend.

import { useState } from "react";
import type { Footprint } from "@askarthur/scam-engine/phone-footprint";
import { FootprintReport } from "@/components/phone-footprint/FootprintReport";

interface ApiFootprint extends Footprint {
  ownership_proven: boolean;
  crossip_downgrade: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; data: ApiFootprint }
  | { kind: "error"; message: string; needsTurnstile?: boolean };

export function LookupForm() {
  const [msisdn, setMsisdn] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = msisdn.trim();
    if (!trimmed) return;
    setStatus({ kind: "loading" });

    try {
      const res = await fetch(`/api/phone-footprint/${encodeURIComponent(trimmed)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (res.status === 428) {
        setStatus({
          kind: "error",
          message:
            "Please complete the verification challenge on the next lookup. Refresh the page and try again.",
          needsTurnstile: true,
        });
        return;
      }
      if (res.status === 429) {
        setStatus({
          kind: "error",
          message: "You've hit the rate limit for lookups. Try again later or sign in for a higher cap.",
        });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus({
          kind: "error",
          message: `Lookup failed (${res.status}): ${body?.error ?? "unknown error"}`,
        });
        return;
      }
      const data = (await res.json()) as ApiFootprint;
      setStatus({ kind: "success", data });
    } catch (err) {
      setStatus({
        kind: "error",
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={submit}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        aria-label="Phone footprint lookup"
      >
        <div className="flex-1">
          <label htmlFor="msisdn-input" className="block text-xs font-medium tracking-wider uppercase text-gray-700">
            Phone number
          </label>
          <input
            id="msisdn-input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+61412345678 or 0412 345 678"
            value={msisdn}
            onChange={(e) => setMsisdn(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base text-gray-900 focus:border-gray-500 focus:outline-none"
            required
          />
        </div>
        <button
          type="submit"
          disabled={status.kind === "loading"}
          className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {status.kind === "loading" ? "Checking…" : "Check footprint"}
        </button>
      </form>

      {status.kind === "error" && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {status.message}
        </div>
      )}

      {status.kind === "success" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <FootprintReport
            footprint={status.data}
            ownershipProven={status.data.ownership_proven}
            crossIpDowngrade={status.data.crossip_downgrade}
          />
        </div>
      )}
    </div>
  );
}
