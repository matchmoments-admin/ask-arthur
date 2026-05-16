"use client";

import { useState, useTransition } from "react";
import { COUNTRY_FLAGS } from "@/lib/feed";
import { promoteRow, deleteRow } from "./actions";
import type { QuarantineRow } from "./page";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function QuarantineTable({ rows }: { rows: QuarantineRow[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-gov-slate text-sm">
        Quarantine empty. Subscribe to a newsletter via{" "}
        <code className="font-mono text-xs">&lt;tag&gt;+ingest@askarthur-inbound.com</code> to start
        seeing inbound items here.
      </div>
    );
  }

  const handle = (id: number, action: "promote" | "delete") => {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await (action === "promote" ? promoteRow(id) : deleteRow(id));
      setBusyId(null);
      if (!result.ok) {
        setError(`Failed to ${action} row ${id}: ${result.error ?? "unknown error"}`);
      } else if (openId === id) {
        setOpenId(null);
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900">
          {error}
        </div>
      )}

      {rows.map((row) => {
        const isOpen = openId === row.id;
        const isBusy = busyId === row.id;
        const flag = row.country_code ? COUNTRY_FLAGS[row.country_code] : null;

        return (
          <article
            key={row.id}
            className={`rounded-lg border bg-white overflow-hidden transition-colors ${
              row.is_subscription_admin
                ? "border-slate-200"
                : "border-amber-200 ring-1 ring-amber-100"
            }`}
          >
            <header
              className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50"
              onClick={() => setOpenId(isOpen ? null : row.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-gov-slate mb-1">
                  <span className="font-semibold text-deep-navy">{row.source_label}</span>
                  <span className="text-slate-300">·</span>
                  <span>{formatDate(row.received_at)}</span>
                  {flag && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{flag}</span>
                    </>
                  )}
                  {row.is_regulator && (
                    <span className="ml-2 rounded-full bg-deep-navy text-white px-2 py-0.5 text-[10px] font-semibold">
                      Regulator
                    </span>
                  )}
                  {row.is_subscription_admin && (
                    <span className="ml-2 rounded-full bg-slate-200 text-slate-700 px-2 py-0.5 text-[10px] font-semibold">
                      Subscription admin
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-slate-400 font-mono">#{row.id}</span>
                </div>
                <h3 className="text-deep-navy font-medium text-sm line-clamp-2">{row.title}</h3>
                <p className="mt-1 text-xs text-slate-500">
                  {row.body_chars.toLocaleString()} chars
                  {row.url && (
                    <>
                      {" · "}
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-action-teal underline break-all"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.url.length > 90 ? `${row.url.slice(0, 90)}…` : row.url}
                      </a>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        `Promote row ${row.id} to the public /scam-feed?\n\n"${row.title}"`,
                      )
                    ) {
                      handle(row.id, "promote");
                    }
                  }}
                  disabled={isBusy}
                  className="rounded-md bg-action-teal text-white text-xs font-semibold px-3 py-1.5 hover:bg-action-teal/90 disabled:opacity-50"
                >
                  {isBusy ? "…" : "Promote"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      window.confirm(
                        `Permanently delete row ${row.id}?\n\n"${row.title}"\n\nThis cannot be undone.`,
                      )
                    ) {
                      handle(row.id, "delete");
                    }
                  }}
                  disabled={isBusy}
                  className="rounded-md border border-red-300 text-red-700 text-xs font-semibold px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </header>

            {isOpen && (
              <div className="border-t border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs text-gov-slate uppercase tracking-wide font-semibold mb-2">
                  Body preview (first 600 chars)
                </p>
                <pre className="text-xs text-slate-800 whitespace-pre-wrap font-mono leading-relaxed max-h-[300px] overflow-y-auto bg-white border border-slate-200 rounded p-3">
                  {row.body_preview}
                  {row.body_chars > 600 && (
                    <span className="text-slate-400 italic">
                      {"\n\n"}… ({(row.body_chars - 600).toLocaleString()} more chars)
                    </span>
                  )}
                </pre>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
