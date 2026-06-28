"use client";

import { Fragment, useState } from "react";
import type { ChecksRow } from "./page";

// Admin-internal raw-verdict colouring (operators see the canonical enum; this
// is NOT a consumer surface, so it does not follow the "never say safe" UI rule).
const VERDICT_COLOURS: Record<string, string> = {
  SAFE: "bg-emerald-50 text-emerald-900 border-emerald-200",
  UNCERTAIN: "bg-amber-50 text-amber-900 border-amber-200",
  SUSPICIOUS: "bg-orange-50 text-orange-900 border-orange-200",
  HIGH_RISK: "bg-red-50 text-red-900 border-red-200",
};

function verdictClass(verdict: string): string {
  return VERDICT_COLOURS[verdict] ?? "bg-slate-100 text-slate-800 border-slate-200";
}

export default function ChecksTable({ rows }: { rows: ChecksRow[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-gov-slate text-sm">
        No checks in this window for the selected filters.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-gov-slate">
          <tr>
            <th className="px-3 py-2 text-left">ID</th>
            <th className="px-3 py-2 text-left">When</th>
            <th className="px-3 py-2 text-left">Source</th>
            <th className="px-3 py-2 text-left">Verdict</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-left">Brand</th>
            <th className="px-3 py-2 text-left">Region</th>
            <th className="px-3 py-2 text-left">Content (preview)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isOpen = openId === row.id;
            const preview = (row.scrubbed_content ?? "").slice(0, 160);
            return (
              <Fragment key={row.id}>
                <tr
                  className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                  onClick={() => setOpenId(isOpen ? null : row.id)}
                >
                  <td className="px-3 py-2 font-mono text-xs text-deep-navy">{row.id}</td>
                  <td className="px-3 py-2 text-gov-slate text-xs whitespace-nowrap">
                    {formatRelative(row.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800">
                      {row.source ?? "—"}
                    </span>
                    {row.input_mode && (
                      <span className="ml-1 text-[11px] text-gov-slate">{row.input_mode}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${verdictClass(row.verdict)}`}
                    >
                      {row.verdict}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gov-slate">{row.scam_type ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gov-slate">
                    {row.impersonated_brand ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gov-slate whitespace-nowrap">
                    {row.region ?? row.country_code ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-gov-slate truncate max-w-xs">
                    {preview || <span className="italic">no content</span>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50 border-t border-slate-100">
                    <td colSpan={8} className="px-4 py-3 text-xs text-deep-navy">
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

function DetailGrid({ row }: { row: ChecksRow }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 max-w-4xl">
      <Field label="Report ID" value={String(row.id)} mono />
      <Field label="Created" value={new Date(row.created_at).toISOString()} mono />
      <Field label="Source" value={row.source ?? "—"} />
      <Field label="Input mode" value={row.input_mode ?? "—"} />
      <Field label="Channel" value={row.channel ?? "—"} />
      <Field
        label="Confidence"
        value={row.confidence_score == null ? "—" : row.confidence_score.toFixed(2)}
        mono
      />
      <Field label="Scam type" value={row.scam_type ?? "—"} />
      <Field label="Impersonated brand" value={row.impersonated_brand ?? "—"} />
      <Field label="Region / country" value={`${row.region ?? "—"} · ${row.country_code ?? "—"}`} />
      {row.scrubbed_content && (
        <div className="col-span-2 mt-2">
          <div className="text-xs uppercase tracking-wide text-gov-slate mb-1">
            Scrubbed content (first 1000 chars)
          </div>
          <div className="rounded border border-slate-200 bg-white p-2 text-sm whitespace-pre-wrap font-mono text-xs">
            {row.scrubbed_content.slice(0, 1000)}
            {row.scrubbed_content.length > 1000 && (
              <span className="text-gov-slate">
                {" "}
                … (+{row.scrubbed_content.length - 1000} chars)
              </span>
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
