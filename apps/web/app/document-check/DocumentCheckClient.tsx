"use client";

import { useState } from "react";
import { type WebDocumentCheckResponse } from "@askarthur/types";
import DocumentCheckResult from "@/components/DocumentCheckResult";
import { submitDocumentCheckFile } from "@/lib/documentCheckClient";

// Client half of /document-check: PDF upload → deterministic structural
// findings + AU content checks. Submission/error semantics live in the
// shared lib/documentCheckClient.ts and rendering in
// components/DocumentCheckResult.tsx — both shared verbatim with the
// homepage ScamChecker's document mode, so the two surfaces can't drift.
//
// Design tokens (DESIGN_SYSTEM.md): marketing card (white, border-light,
// rounded-xl, shadow-sm); deep-navy primary button.

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
    const outcome = await submitDocumentCheckFile(file, "web");
    if (outcome.ok) {
      setResult(outcome.result);
    } else {
      setError(outcome.message);
    }
    setBusy(false);
  }

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
        <div className="border-t border-border-light pt-5">
          <DocumentCheckResult result={result} />
        </div>
      ) : null}
    </section>
  );
}
