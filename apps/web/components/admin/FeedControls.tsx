"use client";

import { useState } from "react";
import type { FeedControlRow } from "@/lib/dashboard/feed-controls";

// Feed control panel on /admin/health (#952). Read-only health already lived
// here; these are the actions that used to require SQL + `gh workflow run`.
// Worst-first ordering comes from the loader, so "disabled" feeds — the ones
// that never resolve themselves — sit at the top where they can't be missed.

const STATE_STYLE: Record<FeedControlRow["state"], { label: string; cls: string }> = {
  disabled: { label: "OFF — will not resume", cls: "bg-red-50 text-red-800 border-red-200" },
  stale: { label: "stale", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  "never-run": { label: "never run", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  muted: { label: "muted", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  ok: { label: "ok", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

export default function FeedControls({ rows }: { rows: FeedControlRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function act(slug: string, action: string, extra?: { days?: number; reason?: string }) {
    if (action === "disable" && !window.confirm(`Switch ${slug} OFF? It will not resume on its own.`)) return;
    setBusy(`${slug}:${action}`);
    setMsg((m) => ({ ...m, [slug]: "" }));
    try {
      const res = await fetch("/api/admin/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg((m) => ({
          ...m,
          [slug]:
            json.error === "dispatch_failed" || json.error === "github_token_missing"
              ? `probe unavailable (${json.error}) — run: gh workflow run scrape-feeds.yml -f feed=${slug}`
              : `failed: ${json.error ?? res.status}`,
        }));
        return;
      }
      setMsg((m) => ({ ...m, [slug]: action === "probe" ? "probe dispatched ✓" : "updated ✓ (refresh to re-read)" }));
    } catch {
      setMsg((m) => ({ ...m, [slug]: "request failed" }));
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <p className="mt-2 text-sm text-slate-500">No feeds configured.</p>;
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Feed</th>
            <th className="px-3 py-2">State</th>
            <th className="px-3 py-2 text-right">Since success</th>
            <th className="px-3 py-2 text-right">Rows 7d</th>
            <th className="px-3 py-2">Controls</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const st = STATE_STYLE[r.state];
            const isBusy = busy?.startsWith(`${r.slug}:`);
            return (
              <tr key={r.slug} className="align-top">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-slate-800">{r.slug}</div>
                  {r.mutedReason && (
                    <div className="mt-0.5 max-w-xs text-[11px] leading-snug text-slate-500">{r.mutedReason}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                    {st.label}
                  </span>
                  {r.mutedUntil && (
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      until {new Date(r.mutedUntil).toISOString().slice(0, 10)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                  {r.hoursSinceSuccess == null ? "—" : `${Math.round(r.hoursSinceSuccess)}h`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.newRows7d}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1.5">
                    {r.enabled ? (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "disable")} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                        Switch off
                      </button>
                    ) : (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "enable")} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                        Turn back on
                      </button>
                    )}
                    {r.mutedUntil ? (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "unmute")} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                        Unmute
                      </button>
                    ) : (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "mute", { days: 14, reason: "muted from /admin/health" })} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                        Mute 14d
                      </button>
                    )}
                    {r.dispatchTarget && (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "probe")} className="rounded border border-deep-navy bg-deep-navy/5 px-2 py-1 text-xs text-deep-navy hover:bg-deep-navy/10 disabled:opacity-50">
                        Probe now
                      </button>
                    )}
                  </div>
                  {msg[r.slug] && <div className="mt-1 text-[11px] text-slate-600">{msg[r.slug]}</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
