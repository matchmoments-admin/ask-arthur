"use client";

import { useState } from "react";
import type { FeedControlRow } from "@/lib/dashboard/feed-controls";

// Feed control panel on /admin/health (#952). These controls govern ALERTING,
// not scraping — feed_sources.enabled / muted_until are read only by
// check_scraper_failures.py to decide whether a failing feed pages you. The
// labels say that plainly; an earlier version said "switched off entirely",
// which was not true of what the columns do.

const STATE_STYLE: Record<FeedControlRow["state"], { label: string; cls: string }> = {
  stale: { label: "stale", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  "never-run": { label: "never run", cls: "bg-amber-50 text-amber-800 border-amber-200" },
  silenced: { label: "alerts silenced (no expiry)", cls: "bg-red-50 text-red-800 border-red-200" },
  muted: { label: "alerts silenced (expires)", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  ok: { label: "ok", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  retired: { label: "retired / not a scraper", cls: "bg-slate-50 text-slate-500 border-slate-200" },
};

export default function FeedControls({ rows }: { rows: FeedControlRow[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});

  async function act(slug: string, action: string, extra?: { days?: number; reason?: string }) {
    // `disable` collects its reason via prompt before calling in, so skip the
    // generic confirm for it.
    // Both directions need a confirm. Un-silencing is the dangerous one:
    // phishstats is silenced precisely because a 100%-failing upstream pages
    // ~3×/day, and one click restores that storm.
    const prompts: Record<string, string> = {
      mute: `Silence alerts for ${slug} for 14 days?`,
      unmute: `Resume alerts for ${slug}? If its upstream is still failing, paging restarts immediately.`,
      enable: `Resume alerts for ${slug}? If its upstream is still failing, paging restarts immediately.`,
    };
    if (prompts[action] && !window.confirm(prompts[action])) return;
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
                      <button type="button" disabled={isBusy} onClick={() => {
                          const why = window.prompt(`Why are alerts being silenced for ${r.slug}? (recorded on the row)`);
                          if (why && why.trim()) act(r.slug, "disable", { reason: why.trim() });
                        }} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                        Silence alerts
                      </button>
                    ) : (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "enable")} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100 disabled:opacity-50">
                        Resume alerts
                      </button>
                    )}
                    {r.mutedUntil ? (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "unmute")} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                        Resume now
                      </button>
                    ) : (
                      <button type="button" disabled={isBusy} onClick={() => act(r.slug, "mute", { days: 14, reason: "muted from /admin/health" })} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50">
                        Silence 14d
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
