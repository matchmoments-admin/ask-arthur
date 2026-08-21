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
// findings. Every finding string comes from DOCUMENT_CHECK_COPY and the
// empty-findings state renders DOCUMENT_CHECK_CLEAN_COPY (the asymmetry
// rule) — both guarded by documentCheckCopy.test.ts, so this surface can't
// drift into verdict language.

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

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <div className="space-y-1">
        <label htmlFor="document-file" className="text-sm font-medium text-gray-900">
          PDF document (up to 10 MB)
        </label>
        <input
          id="document-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
        <p className="text-xs text-gray-500">
          Reads the file&rsquo;s structure and metadata only — your document is
          checked in memory and never stored. Photographed or scanned documents
          aren&rsquo;t supported yet.
        </p>
      </div>

      <button
        onClick={runCheck}
        disabled={busy || !file}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Check document"}
      </button>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {result?.checked ? (
        <div className="space-y-3 border-t border-gray-100 pt-4 text-sm">
          {result.findings.length > 0 ? (
            <ul className="space-y-3">
              {result.findings.map((f) => {
                const copy = DOCUMENT_CHECK_COPY[f.signal];
                // Deploy skew: a new server signal reaching an old client
                // bundle renders nothing rather than crashing the list.
                if (!copy) return null;
                const evidence = Object.entries(f.evidence);
                return (
                  <li key={f.signal} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="font-medium text-gray-900">{copy.label}</p>
                    <p className="mt-1 text-gray-700">{copy.explain}</p>
                    {evidence.length > 0 ? (
                      <p className="mt-1 font-mono text-xs text-gray-500">
                        {evidence.map(([k, v]) => `${k}: ${v}`).join(" · ")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="font-medium text-gray-900">{DOCUMENT_CHECK_CLEAN_LABEL}</p>
              <p className="mt-1 text-gray-700">{DOCUMENT_CHECK_CLEAN_COPY}</p>
            </div>
          )}

          {result.content && result.content.abns.length > 0 ? (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-gray-500">ABNs found on this document</p>
              <ul className="mt-1 space-y-1">
                {result.content.abns.map((a) => (
                  <li key={a.abn} className="flex justify-between gap-4">
                    <span className="font-mono text-xs text-gray-700">{a.abn}</span>
                    <span className="text-right text-gray-800">
                      {a.status === "registered"
                        ? `registered${a.entityName ? ` — ${a.entityName}` : ""}`
                        : a.status === "not_registered"
                          ? "not on the ABR register"
                          : a.status === "invalid_checksum"
                            ? "not a possible ABN"
                            : "could not be checked"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.content && !result.content.textExtracted ? (
            <p className="text-xs text-gray-500">
              No text could be read from this file (scanned or image-based
              PDFs aren&rsquo;t supported yet), so content checks didn&rsquo;t
              run.
            </p>
          ) : null}

          <dl className="space-y-2">
            {result.structural?.info.producer ? (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Produced by</dt>
                <dd className="text-right text-gray-800">{result.structural.info.producer}</dd>
              </div>
            ) : null}
            {result.structural?.info.creator ? (
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Created with</dt>
                <dd className="text-right text-gray-800">{result.structural.info.creator}</dd>
              </div>
            ) : null}
            {result.docSha256 ? (
              <div>
                <dt className="text-gray-500">Document SHA-256</dt>
                <dd className="break-all font-mono text-xs text-gray-700">{result.docSha256}</dd>
              </div>
            ) : null}
          </dl>

          <p className="text-xs text-gray-500">{result.disclaimer}</p>
        </div>
      ) : null}
    </section>
  );
}
