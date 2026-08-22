// Document-check result block — shared by the standalone /document-check
// page and the homepage ScamChecker's document mode. Renders UNWRAPPED
// (callers own the card container) so each surface keeps its own chrome.
//
// Epistemics carried by construction: every finding string comes from
// DOCUMENT_CHECK_COPY, zero findings renders DOCUMENT_CHECK_CLEAN_COPY in a
// deliberately NEUTRAL palette (never the SAFE green — "no editing traces"
// is not a safety verdict), and unknown future signals render nothing
// rather than crashing (deploy skew). Guarded by documentCheckCopy.test.ts.

import {
  DOCUMENT_CHECK_CLEAN_COPY,
  DOCUMENT_CHECK_CLEAN_LABEL,
  DOCUMENT_CHECK_COPY,
  type DocumentAbnCheck,
  type DocumentFinding,
  type WebDocumentCheckResponse,
} from "@askarthur/types";

/** Exported for the /document-check/[ref] evidence page — the persisted
 *  record must describe a signal with EXACTLY the words the user saw at
 *  check time, so there is one copy of this mapping. */
export function abnStatusLine(a: DocumentAbnCheck): { text: string; tone: "neutral" | "warn" } {
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
}

/** The findings list — shared with the evidence page. Unknown future
 *  signals render nothing (deploy skew). `showEvidence` is off on the
 *  evidence page, which persists only signal names. */
export function DocumentFindingsList({
  findings,
  showEvidence = true,
}: {
  findings: DocumentFinding[];
  showEvidence?: boolean;
}) {
  return (
    <ul className="space-y-3">
      {findings.map((f) => {
        const copy = DOCUMENT_CHECK_COPY[f.signal];
        if (!copy) return null;
        const evidence = showEvidence ? Object.entries(f.evidence) : [];
        return (
          <li key={f.signal} className="rounded-xl border border-[#FFE082] bg-[#FFF8E1] p-4">
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
  );
}

/** The ABN table — shared with the evidence page. */
export function DocumentAbnList({
  abns,
  heading,
}: {
  abns: DocumentAbnCheck[];
  heading: string;
}) {
  return (
    <div className="rounded-xl border border-border-light p-4">
      <p className="text-xs font-bold uppercase tracking-widest text-deep-navy">
        {heading}
      </p>
      <ul className="mt-2 space-y-1.5">
        {abns.map((a) => {
          const line = abnStatusLine(a);
          return (
            <li key={a.abn} className="flex justify-between gap-4">
              <span className="font-mono text-xs text-gov-slate">{a.abn}</span>
              <span
                className={`text-right ${
                  line.tone === "warn" ? "font-medium text-[#F57C00]" : "text-gov-slate"
                }`}
              >
                {line.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function DocumentCheckResult({
  result,
}: {
  result: WebDocumentCheckResponse;
}) {
  if (!result.checked) return null;

  return (
    <div className="space-y-4 text-sm">
      {result.findings.length > 0 ? (
        <DocumentFindingsList findings={result.findings} />
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
        <DocumentAbnList
          abns={result.content.abns}
          heading="ABNs found on this document"
        />
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
  );
}
