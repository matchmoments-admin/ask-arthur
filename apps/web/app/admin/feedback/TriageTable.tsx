"use client";

import { Fragment, useState } from "react";
import type { TriageRow } from "./page";

const VERDICT_COLOURS: Record<TriageRow["verdict_given"], string> = {
  SAFE: "bg-emerald-50 text-emerald-900 border-emerald-200",
  UNCERTAIN: "bg-amber-50 text-amber-900 border-amber-200",
  SUSPICIOUS: "bg-orange-50 text-orange-900 border-orange-200",
  HIGH_RISK: "bg-red-50 text-red-900 border-red-200",
};

const USER_SAYS_COLOURS: Record<TriageRow["user_says"], string> = {
  false_positive: "bg-slate-100 text-slate-800",
  false_negative: "bg-red-100 text-red-900",
  user_reported: "bg-amber-100 text-amber-900",
};

export default function TriageTable({ rows }: { rows: TriageRow[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-gov-slate text-sm">
        No feedback in the last 30 days for this filter.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gov-slate">
          <tr>
            <th className="px-3 py-2 text-left">Score</th>
            <th className="px-3 py-2 text-left">When</th>
            <th className="px-3 py-2 text-left">Verdict given</th>
            <th className="px-3 py-2 text-left">User says</th>
            <th className="px-3 py-2 text-right">Confidence</th>
            <th className="px-3 py-2 text-left">Reason codes</th>
            <th className="px-3 py-2 text-left">Content (preview)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = openId === row.feedback_id;
            const previewContent = (row.scrubbed_content ?? "").slice(0, 80);
            return (
              <Fragment key={row.feedback_id}>
                <tr
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setOpenId(isOpen ? null : row.feedback_id)}
                >
                  <td className="px-3 py-2 font-mono text-xs text-deep-navy">
                    {row.triage_score.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-gov-slate text-xs whitespace-nowrap">
                    {formatRelative(row.feedback_created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${VERDICT_COLOURS[row.verdict_given]}`}
                    >
                      {row.verdict_given}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${USER_SAYS_COLOURS[row.user_says]}`}
                    >
                      {row.user_says.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {row.verdict_confidence == null ? "—" : row.verdict_confidence.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-xs text-gov-slate">
                    {row.reason_codes?.length ? row.reason_codes.join(", ") : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gov-slate truncate max-w-xs">
                    {previewContent || <span className="italic">no content</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50 border-t border-slate-100">
                    <td colSpan={7} className="px-4 py-3 text-xs text-deep-navy">
                      <DetailGrid row={row} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailGrid({ row }: { row: TriageRow }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 max-w-4xl">
      <Field label="Feedback ID" value={String(row.feedback_id)} mono />
      <Field label="Report ID" value={row.report_id ? String(row.report_id) : "(none — orphan)"} mono />
      <Field label="Analysis ID" value={row.analysis_id ?? "—"} mono />
      <Field label="Content hash" value={row.submitted_content_hash ?? "—"} mono />
      <Field label="Source" value={row.report_source ?? "—"} />
      <Field label="Scam type" value={row.scam_type ?? "—"} />
      <Field label="Impersonated brand" value={row.impersonated_brand ?? "—"} />
      <Field label="Locale / UA" value={`${row.locale ?? "—"} · ${row.user_agent_family ?? "—"}`} />
      <Field label="Training consent" value={row.training_consent ? "yes" : "no"} />
      <Field
        label="Uncertainty × impact"
        value={`${row.uncertainty.toFixed(2)} × ${row.impact_weight} = ${row.triage_score.toFixed(2)}`}
        mono
      />
      <div className="col-span-2 mt-2">
        <div className="text-xs uppercase tracking-wide text-gov-slate mb-1">Comment</div>
        <div className="rounded border border-slate-200 bg-white p-2 text-sm whitespace-pre-wrap">
          {row.comment ?? <span className="italic text-gov-slate">no comment</span>}
        </div>
      </div>
      {row.scrubbed_content && (
        <div className="col-span-2 mt-2">
          <div className="text-xs uppercase tracking-wide text-gov-slate mb-1">
            Scrubbed content (first 1000 chars)
          </div>
          <div className="rounded border border-slate-200 bg-white p-2 text-sm whitespace-pre-wrap font-mono text-xs">
            {row.scrubbed_content.slice(0, 1000)}
            {row.scrubbed_content.length > 1000 && (
              <span className="text-gov-slate"> … (+{row.scrubbed_content.length - 1000} chars)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gov-slate">{label}</div>
      <div className={`text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  const mins = Math.round(ageMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
