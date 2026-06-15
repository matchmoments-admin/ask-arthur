"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, X, Clock, Send, AlertTriangle } from "lucide-react";

export interface StewardshipRow {
  id: string;
  brandKey: string;
  brandName: string;
  periodMonth: string; // YYYY-MM-01
  detected: number;
  clonesDetected: number;
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
  shadowRecipient,
}: {
  rows: StewardshipRow[];
  /** When set, ALL sends are routed here (validation mode) instead of the brand. */
  shadowRecipient: string | null;
}) {
  const router = useRouter();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(id: string, brandName: string) {
    const where = shadowRecipient
      ? `the SHADOW inbox (${shadowRecipient})`
      : "the brand's real security contact";
    if (!window.confirm(`Send the ${brandName} monthly summary to ${where}?`)) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/brand-stewardship/${id}/send`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail ?? data.error ?? `Send failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setBusyId(null);
    }
  }

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

  // No-contact rows (clones detected, but no security contact → can't email)
  // are surfaced separately as a manual-outreach worklist; everything else
  // flows through the normal per-period review/send list.
  const noContactRows = rows.filter((r) => r.statusReason === "no_contact");
  const normalRows = rows.filter((r) => r.statusReason !== "no_contact");

  // Group by period, newest first (rows arrive pre-sorted by period desc).
  const byPeriod = new Map<string, StewardshipRow[]>();
  for (const r of normalRows) {
    const list = byPeriod.get(r.periodMonth) ?? [];
    list.push(r);
    byPeriod.set(r.periodMonth, list);
  }

  return (
    <>
      {shadowRecipient && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Shadow-send mode active.</strong> All sends go to{" "}
          <code className="text-amber-900">{shadowRecipient}</code> — not the
          brand. Unset <code>BRAND_STEWARDSHIP_SHADOW_RECIPIENT</code> to send to
          real contacts (also requires <code>FF_BRAND_STEWARDSHIP_SEND</code>).
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {noContactRows.length > 0 && (
        <section className="mb-8 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <h2 className="flex items-center gap-2 text-amber-900 text-lg font-bold mb-1">
            <AlertTriangle size={18} />
            Manual outreach — no security contact ({noContactRows.length})
          </h2>
          <p className="text-amber-900/80 text-sm mb-3 leading-relaxed">
            We detected clones impersonating these brands but have no email
            contact in <code>known_brands</code>, so the monthly report can&apos;t
            be sent. Find a <code>security.txt</code> / abuse address (then add it
            and verify), or do manual outreach (e.g. LinkedIn the brand&apos;s
            security lead). Preview shows what they&apos;d receive.
          </p>
          <ul className="space-y-2">
            {noContactRows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-bold text-deep-navy text-sm truncate">
                    {r.brandName}
                  </p>
                  <p className="text-xs text-gov-slate mt-0.5">
                    {r.clonesDetected} clone{r.clonesDetected === 1 ? "" : "s"} ·{" "}
                    {monthLabel(r.periodMonth)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openPreview(r.id)}
                  className="inline-flex shrink-0 min-h-[36px] items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-deep-navy hover:bg-slate-50"
                >
                  <Eye size={14} />
                  Preview
                </button>
              </li>
            ))}
          </ul>
        </section>
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

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gov-slate">
                  <Field label="Detected" value={String(r.detected)} />
                  <Field label="Clones" value={String(r.clonesDetected)} />
                  <Field label="Reports sent" value={String(r.reportsSent)} />
                  <Field label="Brand key" value={r.brandKey} />
                </div>

                {r.statusReason && (
                  <p className="mt-2 text-xs text-gov-slate font-mono">
                    {r.statusReason}
                  </p>
                )}

                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => openPreview(r.id)}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-deep-navy hover:bg-slate-50"
                  >
                    <Eye size={14} />
                    Preview email
                  </button>
                  {(r.status === "prepared" || r.status === "failed") && (
                    <button
                      type="button"
                      onClick={() => send(r.id, r.brandName)}
                      disabled={busyId === r.id}
                      className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full bg-deep-navy px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-navy disabled:opacity-50"
                    >
                      {busyId === r.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                      {shadowRecipient ? "Send to shadow" : "Send to brand"}
                    </button>
                  )}
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
