// Document Check — the ONE copy table for finding display strings.
//
// Product rule (ADR-0015 / ADR-0024 epistemics, applied to documents): every
// finding is a named, explainable signal. Copy must never claim a document is
// fake, forged, genuine, or authentic — the strongest allowed framing is
// "this file records X", and the clean-scan copy MUST carry the asymmetry
// caveat (a scammer's freshly generated document has no editing traces).
// Guarded by apps/web/__tests__/documentCheckCopy.test.ts, which fails the
// build on verdict language or a missing/changed asymmetry line.

import type { DocumentFindingSignal } from "./document-check";

export interface DocumentFindingCopy {
  /** Short display label for the finding row. */
  label: string;
  /** One-sentence plain-language explanation, evidence-neutral. */
  explain: string;
}

export const DOCUMENT_CHECK_COPY: Record<DocumentFindingSignal, DocumentFindingCopy> = {
  multiple_revisions: {
    label: "Saved again after creation",
    explain:
      "This file records incremental updates — it was modified and re-saved at least once after it was first written. Some legitimate workflows do this (e-signing, stamping), so treat it as a reason to look closer, not a conclusion.",
  },
  trailer_id_changed: {
    label: "File identity changed",
    explain:
      "The file's internal ID pair no longer matches, which means the document changed after it was originally created.",
  },
  producer_design_tool: {
    label: "Made with a design tool",
    explain:
      "The file's metadata names an image or design editor. Payroll systems, banks and accounting software don't normally issue documents through design tools.",
  },
  producer_office_suite: {
    label: "Made with a word processor",
    explain:
      "The file's metadata names a word processor. Small businesses do issue invoices this way — but payslips and bank statements normally come from payroll or banking systems, not a document editor.",
  },
  dates_differ: {
    label: "Modified after creation date",
    explain:
      "The file's modification timestamp differs from its creation timestamp — it was touched again after it was first produced.",
  },
  xmp_edit_history: {
    label: "Editing history recorded",
    explain:
      "The file's embedded metadata records editing events or names a source document it was derived from.",
  },
  encrypted_document: {
    label: "Encrypted document",
    explain:
      "This file is encrypted, so some structural checks could not run. Encryption itself is not suspicious.",
  },
  scan_limited: {
    label: "Limited scan",
    explain:
      "This file stores its metadata in compressed streams this scan doesn't open, so fewer signals were available. That is normal for many modern PDFs and says nothing about the document either way.",
  },
  abn_checksum_fail: {
    label: "ABN fails its checksum",
    explain:
      "An ABN printed on this document isn't a mathematically possible ABN. Real ABNs pass a checksum; a typo can cause this too, so compare the number against ABN Lookup yourself.",
  },
  abn_not_registered: {
    label: "ABN not on the register",
    explain:
      "An ABN printed on this document is not on the Australian Business Register. Check the number on abr.business.gov.au and confirm the business through a channel you already trust before paying.",
  },
  abn_cancelled: {
    label: "ABN cancelled on the register",
    explain:
      "An ABN printed on this document exists on the Australian Business Register but is no longer active. Businesses do close — but a cancelled ABN on a current invoice or payslip is worth confirming through a channel you already trust.",
  },
};

/** Heading for the zero-findings state. Lives here (not hardcoded in the
 *  page) so the honesty test covers the surface's most verdict-prone string. */
export const DOCUMENT_CHECK_CLEAN_LABEL = "No editing traces found";

/** Client-side pre-check copy — lives in the guarded table so the honesty
 *  test covers it and both surfaces render identical strings. */
export const DOCUMENT_CHECK_OVERSIZE_COPY =
  "That PDF is over 10 MB. Try a smaller export.";
export const DOCUMENT_CHECK_NOT_PDF_COPY =
  "That file doesn't look like a PDF. Only PDF documents are supported for now.";

/** Copy for a scan that could not run (checked:false / scan_unavailable) —
 *  which is NOT the clean state and must never borrow its copy. */
export const DOCUMENT_CHECK_UNAVAILABLE_COPY =
  "We couldn't read this file's structure, so no checks ran. That says nothing about the document either way — try re-exporting it as a standard PDF, or verify the details with the sender directly.";

/** The asymmetry rule, verbatim — shown whenever a scan finds nothing.
 *  The copy test asserts this exact framing survives edits. */
export const DOCUMENT_CHECK_CLEAN_COPY =
  "A clean structural scan means we found no editing traces — not that the document is real. A document created from scratch by a scammer carries no revision history at all. Always verify payment details and issuer identity through a channel you already trust.";

export const DOCUMENT_CHECK_DISCLAIMER =
  "These are structural signals read directly from the file, not a verdict. Files can be modified for legitimate reasons, and convincing fraudulent documents can be built with no traces. If money is involved, confirm the details with the organisation via a phone number or website you find independently.";
