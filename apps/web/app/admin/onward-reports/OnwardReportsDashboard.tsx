"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";

interface ReviewRow {
  id: string;
  scam_report_id: number | null;
  destination: string;
  destination_key: string | null;
  status: string;
  status_reason: string | null;
  queued_at: string;
  scam_type: string | null;
  impersonated_brand: string | null;
  channel: string | null;
  brand_name: string | null;
  brand_security_email: string | null;
  sent_so_far_for_brand: number;
}

interface Props {
  manualReview: ReviewRow[];
  recent: ReviewRow[];
}

const STATUS_TONE: Record<string, string> = {
  sent: "text-emerald-700 bg-emerald-50",
  queued: "text-blue-700 bg-blue-50",
  skipped: "text-amber-800 bg-amber-50",
  manual_review: "text-slate-700 bg-slate-100",
  failed: "text-red-700 bg-red-50",
};

export default function OnwardReportsDashboard({
  manualReview,
  recent,
}: Props) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      let reject_reason: string | undefined;
      if (action === "reject") {
        const reason = window.prompt(
          "Why are you rejecting this onward report? (1–2 sentences)"
        );
        if (!reason) {
          setBusyId(null);
          return;
        }
        reject_reason = reason;
      }
      const res = await fetch("/api/admin/onward-reports/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log_id: id, action, reject_reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section>
        <h2 className="text-deep-navy text-lg font-bold mb-3">
          Awaiting review ({manualReview.length})
        </h2>
        {manualReview.length === 0 ? (
          <p className="text-sm text-gov-slate bg-slate-50 border border-slate-200 rounded-lg px-4 py-6 text-center">
            Nothing in the queue. Brand-abuse sends auto-go through once each
            brand has 10 reviewed approvals on the clock.
          </p>
        ) : (
          <ul className="space-y-3">
            {manualReview.map((r) => (
              <li
                key={r.id}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="font-bold text-deep-navy text-sm">
                      {r.destination === "brand_abuse"
                        ? `Brand abuse → ${r.brand_name ?? r.destination_key ?? "(unknown brand)"}`
                        : r.destination}
                    </p>
                    <p className="text-xs text-gov-slate mt-0.5">
                      Queued {new Date(r.queued_at).toLocaleString("en-AU")}
                      {r.brand_security_email && (
                        <>
                          {" · "}
                          <code className="text-deep-navy">
                            {r.brand_security_email}
                          </code>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full text-slate-700 bg-slate-100">
                    {r.sent_so_far_for_brand}/10 prior
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gov-slate">
                  <Field
                    label="Scam report"
                    value={
                      r.scam_report_id
                        ? `#${r.scam_report_id}`
                        : "—"
                    }
                  />
                  <Field label="Type" value={r.scam_type ?? "—"} />
                  <Field
                    label="Impersonating"
                    value={r.impersonated_brand ?? "—"}
                  />
                  <Field label="Channel" value={r.channel ?? "—"} />
                </div>

                {r.status_reason && (
                  <p className="mt-2 text-xs text-gov-slate font-mono">
                    {r.status_reason}
                  </p>
                )}

                <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => act(r.id, "reject")}
                    disabled={busyId === r.id}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busyId === r.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <XCircle size={14} />
                    )}
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => act(r.id, "approve")}
                    disabled={busyId === r.id}
                    className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full bg-deep-navy px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-navy disabled:opacity-50"
                  >
                    {busyId === r.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <CheckCircle size={14} />
                    )}
                    Approve & send
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-deep-navy text-lg font-bold mb-3">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gov-slate bg-slate-50 border border-slate-200 rounded-lg px-4 py-6 text-center">
            No completed reports yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-deep-navy text-sm truncate">
                    {r.destination === "brand_abuse"
                      ? `Brand abuse → ${r.brand_name ?? r.destination_key}`
                      : r.destination}
                    {r.scam_report_id && (
                      <span className="ml-2 text-xs text-gov-slate">
                        report #{r.scam_report_id}
                      </span>
                    )}
                  </p>
                  {r.status_reason && (
                    <p className="text-xs text-gov-slate font-mono truncate">
                      {r.status_reason}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gov-slate">
                    <Clock size={10} className="inline mr-0.5" />
                    {new Date(r.queued_at).toLocaleDateString("en-AU")}
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full ${STATUS_TONE[r.status] ?? "bg-slate-50 text-slate-700"}`}
                  >
                    {r.status.replace("_", " ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
