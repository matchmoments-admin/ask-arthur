"use client";

import { useState } from "react";
import { Eye, Loader2, X, Clock } from "lucide-react";

export interface StewardshipRow {
  id: string;
  brandKey: string;
  brandName: string;
  periodMonth: string; // YYYY-MM-01
  detected: number;
  reportsSent: number;
  recipientEmail: string | null;
  status: string;
  statusReason: string | null;
  preparedAt: string | null;
  sentAt: string | null;
}

const STATUS_TONE: Record<string, string> = {
  prepared: "text-blue-700 bg-blue-50",
  pending_send: "text-amber-800 bg-amber-50",
  sent: "text-emerald-700 bg-emerald-50",
  skipped: "text-slate-700 bg-slate-100",
  failed: "text-red-700 bg-red-50",
};

function monthLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function BrandStewardshipDashboard({
  rows,
}: {
  rows: StewardshipRow[];
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPreview(id: string) {
    setPreviewId(id);
    setPreviewHtml(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/brand-stewardship/${id}/preview`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Preview failed (${res.status})`);
      }
      setPreviewHtml(await res.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setPreviewId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gov-slate bg-slate-50 border border-slate-200 rounded-lg px-4 py-6 text-center">
        No stewardship reports prepared yet. The monthly cron prepares rows on
        the 1st of each month for brands with onward-report activity and a known
        security contact.
      </p>
    );
  }

  // Group by period, newest first (rows arrive pre-sorted by period desc).
  const byPeriod = new Map<string, StewardshipRow[]>();
  for (const r of rows) {
    const list = byPeriod.get(r.periodMonth) ?? [];
    list.push(r);
    byPeriod.set(r.periodMonth, list);
  }

  return (
    <>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {[...byPeriod.entries()].map(([period, list]) => (
        <section key={period} className="mb-8">
          <h2 className="text-deep-navy text-lg font-bold mb-3">
            {monthLabel(period)}{" "}
            <span className="text-gov-slate font-normal text-sm">
              ({list.length} brand{list.length === 1 ? "" : "s"})
            </span>
          </h2>
          <ul className="space-y-3">
            {list.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-bold text-deep-navy text-sm">
                      {r.brandName}
                    </p>
                    <p className="text-xs text-gov-slate mt-0.5">
                      {r.recipientEmail ? (
                        <code className="text-deep-navy">
                          {r.recipientEmail}
                        </code>
                      ) : (
                        "no recipient"
                      )}
                      {r.sentAt && (
                        <>
                          {" · "}
                          <Clock size={10} className="inline mr-0.5" />
                          sent {new Date(r.sentAt).toLocaleDateString("en-AU")}
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full ${STATUS_TONE[r.status] ?? "bg-slate-50 text-slate-700"}`}
                  >
                    {r.status.replace("_", " ")}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs text-gov-slate">
                  <Field label="Detected" value={String(r.detected)} />
                  <Field label="Reports sent" value={String(r.reportsSent)} />
                  <Field label="Brand key" value={r.brandKey} />
                </div>

                {r.statusReason && (
                  <p className="mt-2 text-xs text-gov-slate font-mono">
                    {r.statusReason}
                  </p>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={() => openPreview(r.id)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-deep-navy hover:bg-slate-50"
                  >
                    <Eye size={14} />
                    Preview email
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {previewId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPreviewId(null)}
        >
          <div
            className="relative flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-bold text-deep-navy">
                Email preview
              </span>
              <button
                type="button"
                onClick={() => setPreviewId(null)}
                aria-label="Close preview"
                className="rounded-full p-1 text-gov-slate hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-50">
              {previewHtml === null ? (
                <div className="flex h-full items-center justify-center text-gov-slate">
                  <Loader2 size={20} className="animate-spin" />
                </div>
              ) : (
                <iframe
                  title="Brand stewardship email preview"
                  srcDoc={previewHtml}
                  className="h-full w-full border-0 bg-white"
                  sandbox=""
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest">{label}</dt>
      <dd className="text-deep-navy text-xs font-semibold mt-0.5 truncate">
        {value}
      </dd>
    </div>
  );
}
