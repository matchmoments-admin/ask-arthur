"use client";

import { useState } from "react";
import type { BrakeRow } from "@/lib/dashboard/feature-brakes";

// Kill switches on /admin/health (#951). Active brakes sort first because they
// are the ones changing behaviour right now. Features that have never been
// braked are still listed — an empty feature_brakes table must not render as an
// empty console, or the surface is useless on the day you need it.

export default function BrakeControls({ rows }: { rows: BrakeRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function act(feature: string, action: "brake" | "release") {
    if (action === "brake") {
      const ok = window.confirm(
        `Pull the brake on "${feature}" for 24h? Workers checking this key will stop doing paid/outbound work.`,
      );
      if (!ok) return;
    }
    setBusy(`${feature}:${action}`);
    setMsg((m) => ({ ...m, [feature]: "" }));
    try {
      const res = await fetch("/api/admin/brakes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature, action, ...(action === "brake" ? { hours: 24 } : {}) }),
      });
      const json = await res.json().catch(() => ({}));
      setMsg((m) => ({
        ...m,
        [feature]: res.ok
          ? action === "brake"
            ? "braked for 24h ✓ (refresh to re-read)"
            : "released ✓ (refresh to re-read)"
          : `failed: ${json.error ?? res.status}`,
      }));
    } catch {
      setMsg((m) => ({ ...m, [feature]: "request failed" }));
    } finally {
      setBusy(null);
    }
  }

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <div className="mt-3">
      <p className="mb-2 text-xs text-slate-500">
        {activeCount === 0
          ? "No brakes are currently holding — every feature is free to run."
          : `${activeCount} brake${activeCount === 1 ? "" : "s"} currently holding.`}{" "}
        A brake holds while <code>paused_until</code> is in the future; releasing sets it to
        now and keeps the row, so who braked it and why survives for the incident review.
      </p>
      <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Feature</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Set by / when</th>
              <th className="px-3 py-2">Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const isBusy = busy?.startsWith(`${r.feature}:`);
              return (
                <tr key={r.feature}>
                  <td className="px-3 py-2 font-mono text-xs text-slate-800">{r.feature}</td>
                  <td className="px-3 py-2">
                    {r.active ? (
                      <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                        BRAKED until {new Date(r.pausedUntil!).toISOString().slice(0, 16).replace("T", " ")}
                      </span>
                    ) : r.neverSet ? (
                      <span className="text-[11px] text-slate-400">never braked</span>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        expired {r.pausedUntil ? new Date(r.pausedUntil).toISOString().slice(0, 10) : ""}
                      </span>
                    )}
                    {r.reason && <div className="mt-0.5 max-w-sm text-[11px] text-slate-500">{r.reason}</div>}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-slate-500">
                    {r.setBy ?? "—"}
                    {r.setAt ? ` · ${new Date(r.setAt).toISOString().slice(0, 10)}` : ""}
                  </td>
                  <td className="px-3 py-2">
                    {r.active ? (
                      <button type="button" disabled={isBusy} onClick={() => act(r.feature, "release")}
                        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                        Release
                      </button>
                    ) : (
                      <button type="button" disabled={isBusy} onClick={() => act(r.feature, "brake")}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-800 hover:bg-red-50 disabled:opacity-50">
                        Brake 24h
                      </button>
                    )}
                    {msg[r.feature] && <div className="mt-1 text-[11px] text-slate-600">{msg[r.feature]}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
