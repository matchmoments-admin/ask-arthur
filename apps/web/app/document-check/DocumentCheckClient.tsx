"use client";

import { useState } from "react";
import {
  DOCUMENT_CHECK_CLEAN_COPY,
  DOCUMENT_CHECK_CLEAN_LABEL,
  DOCUMENT_CHECK_COPY,
  DOCUMENT_CHECK_UNAVAILABLE_COPY,
  type WebDocumentCheckResponse,
} from "@askarthur/types";

// Client half of /document-check: PDF upload → deterministic structural
// findings + AU content checks. Every finding string comes from
// DOCUMENT_CHECK_COPY and the empty-findings state renders
// DOCUMENT_CHECK_CLEAN_COPY (the asymmetry rule) — both guarded by
// documentCheckCopy.test.ts, so this surface can't drift into verdict
// language.
//
// Design tokens (DESIGN_SYSTEM.md): marketing card (white, border-light,
// rounded-xl, shadow-sm); findings use the SUSPICIOUS verdict palette; the
// clean state is deliberately NEUTRAL (#f8fafc), never the SAFE green — "no
// editing traces" is not a safety verdict.

export default function DocumentCheckClient() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WebDocumentCheckResponse | null>(null);

  async function runCheck() {
    if (!file) {
      setError("Choose a PDF file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/document-check", { method: "POST", body: form });
      const data = (await res.json()) as WebDocumentCheckResponse & {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? "Couldn't check this document. Try again later.");
        return;
      }
      if (!data.checked) {
        // A scan that did not run is NOT the clean state (asymmetry rule).
        setError(DOCUMENT_CHECK_UNAVAILABLE_COPY);
        return;
      }
      setResult(data);
    } catch {
      setError("Couldn't check this document. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  const abnStatusLine = (a: {
    status: string;
    entityName: string | null;
  }): { text: string; tone: "neutral" | "warn" } => {
    switch (a.status) {
      case "registered":
        return {
          text: `registered${a.entityName ? ` — ${a.entityName}` : ""}`,
          tone: "neutral",
        };
      case "cancelled":
        return {
          text: `cancelled on the register${a.entityName ? ` — ${a.entityName}` : ""}`,
          tone: "warn",
        };
      case "not_registered":
        return { text: "not on the ABR register", tone: "warn" };
      case "invalid_checksum":
        return { text: "not a possible ABN", tone: "warn" };
      default:
        return { text: "could not be checked", tone: "neutral" };
    }
  };

  return (
    <section className="bg-white border border-border-light rounded-xl shadow-sm p-6 space-y-5">
      <div className="space-y-2">
        <label htmlFor="document-file" className="block text-sm font-bold text-deep-navy">
          PDF document (up to 10 MB)
        </label>
        <input
          id="document-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm text-gov-slate file:mr-3 file:rounded-lg file:border file:border-border-light file:bg-white file:px-4 file:py-2 file:text-sm file:font-semibold file:text-deep-navy hover:file:bg-slate-50"
        />
        <p className="text-xs text-slate-500 leading-relaxed">
          Reads the file&rsquo;s structure and metadata only — your document is
          checked in memory and never stored. Photographed or scanned documents
          aren&rsquo;t supported yet.
        </p>
      </div>

      <button
        onClick={runCheck}
        disabled={busy || !file}
        className="w-full rounded-lg bg-deep-navy px-6 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Check document"}
      </button>

      {error ? (
        <p className="text-sm leading-relaxed text-[#D32F2F]">{error}</p>
      ) : null}

      {result?.checked ? (
        <div className="space-y-4 border-t border-border-light pt-5 text-sm">
          {result.findings.length > 0 ? (
            <ul className="space-y-3">
              {result.findings.map((f) => {
                const copy = DOCUMENT_CHECK_COPY[f.signal];
                // Deploy skew: a new server signal reaching an old client
                // bundle renders nothing rather than crashing the list.
                if (!copy) return null;
                const evidence = Object.entries(f.evidence);
                return (
                  <li
                    key={f.signal}
                    className="rounded-xl border border-[#FFE082] bg-[#FFF8E1] p-4"
                  >
                    <p className="font-semibold text-[#E65100]">{copy.label}</p>
                    <p className="mt-1 leading-relaxed text-gov-slate">{copy.explain}</p>
                    {evidence.length > 0 ? (
                      <p className="mt-2 font-mono text-xs text-slate-500">
                        {evidence.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            // Deliberately neutral — never the SAFE green (asymmetry rule).
            <div className="rounded-xl border border-border-light bg-[#f8fafc] p-4">
              <p className="font-semibold text-deep-navy">{DOCUMENT_CHECK_CLEAN_LABEL}</p>
              <p className="mt-1 leading-relaxed text-gov-slate">
                {DOCUMENT_CHECK_CLEAN_COPY}
              </p>
            </div>
          )}

          {result.content && result.content.abns.length > 0 ? (
            <div className="rounded-xl border border-border-light p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-deep-navy">
                ABNs found on this document
              </p>
              <ul className="mt-2 space-y-1.5">
                {result.content.abns.map((a) => {
                  const line = abnStatusLine(a);
                  return (
                    <li key={a.abn} className="flex justify-between gap-4">
                      <span className="font-mono text-xs text-gov-slate">{a.abn}</span>
                      <span
                        className={`text-right ${
                          line.tone === "warn"
                            ? "font-medium text-[#F57C00]"
                            : "text-gov-slate"
                        }`}
                      >
                        {line.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {result.content && !result.content.textExtracted ? (
            <p className="text-xs leading-relaxed text-slate-500">
              No text could be read from this file (scanned or image-based PDFs
              aren&rsquo;t supported yet), so content checks didn&rsquo;t run.
            </p>
          ) : null}

          <dl className="space-y-2">
            {result.structural?.info.producer ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Produced by</dt>
                <dd className="text-right text-gov-slate">
                  {result.structural.info.producer}
                </dd>
              </div>
            ) : null}
            {result.structural?.info.creator ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Created with</dt>
                <dd className="text-right text-gov-slate">
                  {result.structural.info.creator}
                </dd>
              </div>
            ) : null}
            {result.docSha256 ? (
              <div>
                <dt className="text-slate-500">Document SHA-256</dt>
                <dd className="break-all font-mono text-xs text-slate-500">
                  {result.docSha256}
                </dd>
              </div>
            ) : null}
          </dl>

          {result.checkRef ? (
            <div className="rounded-xl border border-border-light bg-[#f8fafc] p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-deep-navy">
                Evidence reference
              </p>
              <p className="mt-1">
                <a
                  href={`/document-check/${result.checkRef}`}
                  className="font-mono text-sm text-deep-navy underline"
                >
                  {result.checkRef}
                </a>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                A permanent record of these findings (no document content is
                stored). Quote this reference when reporting or disputing.
              </p>
            </div>
          ) : null}

          <p className="text-xs leading-relaxed text-slate-500">{result.disclaimer}</p>
        </div>
      ) : null}
    </section>
  );
}
