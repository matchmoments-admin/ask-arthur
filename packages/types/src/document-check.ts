// Document Check — shared shapes for the deterministic PDF forensics surface.
//
// Two-layer model (see docs/plans/ + ADR-0015/0024 epistemics):
// - STRUCTURAL layer: jurisdiction-agnostic byte-level PDF forensics
//   (revision history, producer tells, metadata dates). Implemented in
//   @askarthur/scam-engine/document-check.
// - CONTENT layer: jurisdiction packs (AU: ABN / BSB / arithmetic). Lands in
//   a follow-up PR; `content: null` means "not assessed", never "clean".
//
// Findings are NAMED, EXPLAINABLE signals — never a composite score, never a
// FAKE/GENUINE verdict. Display strings live in document-check-copy.ts (one
// copy table, guarded by apps/web/__tests__/documentCheckCopy.test.ts);
// this module carries only data.

/** Named structural signals. Adding one REQUIRES a matching entry in
 *  DOCUMENT_CHECK_COPY — the copy test enforces the pairing. */
export const DOCUMENT_FINDING_SIGNALS = [
  /** The file records one or more incremental updates after its first save. */
  "multiple_revisions",
  /** The trailer /ID pair differs — the file changed since original creation. */
  "trailer_id_changed",
  /** /Producer or /Creator names an image/design editor (Photoshop, Canva…). */
  "producer_design_tool",
  /** /Producer or /Creator names a word processor (Word, Google Docs…). */
  "producer_office_suite",
  /** Metadata modification date differs from the creation date. */
  "dates_differ",
  /** XMP media-management history records editing events or a source file. */
  "xmp_edit_history",
  /** The document is encrypted — some checks could not run. */
  "encrypted_document",
  /** Metadata lives in compressed object streams this scan doesn't open. */
  "scan_limited",
  // ---- content layer (AU jurisdiction pack) --------------------------------
  /** An ABN printed on the document fails the ATO mod-89 checksum. */
  "abn_checksum_fail",
  /** An ABN printed on the document is not on the ABR register (the register
   *  answered cleanly — this is NOT the lookup-failed case, ADR-0009). */
  "abn_not_registered",
] as const;

export type DocumentFindingSignal = (typeof DOCUMENT_FINDING_SIGNALS)[number];

/** One named signal plus the concrete evidence that produced it. Evidence
 *  values are display-safe primitives (tool names, counts, dates) — never
 *  extracted document text. */
export interface DocumentFinding {
  signal: DocumentFindingSignal;
  evidence: Record<string, string | number>;
}

/** Raw /Info dictionary fields, latest revision wins. Null = not found —
 *  which on modern PDFs often means "stored compressed", not "absent". */
export interface PdfInfoFields {
  producer: string | null;
  creator: string | null;
  /** Raw PDF date string (D:YYYYMMDD…) as written. */
  creationDate: string | null;
  modDate: string | null;
}

export interface PdfXmpSummary {
  present: boolean;
  creatorTool: string | null;
  createDate: string | null;
  modifyDate: string | null;
  /** Count of xmpMM:History events, null when no history block exists. */
  historyEvents: number | null;
  /** xmpMM:DerivedFrom present — the file declares a source document. */
  derivedFrom: boolean;
}

/** Byte-level structural summary of one PDF. Everything here is read
 *  directly from the file; nothing is inferred or scored. */
export interface PdfStructuralSummary {
  isPdf: boolean;
  pdfVersion: string | null;
  byteLength: number;
  eofCount: number;
  startxrefCount: number;
  /** Linearized ("fast web view") files legitimately carry an extra
   *  xref/%%EOF pair — incrementalUpdates already accounts for this. */
  linearized: boolean;
  /** Saves recorded AFTER the original write. 0 = single-revision file. */
  incrementalUpdates: number;
  encrypted: boolean;
  hasObjectStreams: boolean;
  info: PdfInfoFields;
  xmp: PdfXmpSummary;
  /** Trailer /ID pair: matches=false means the file changed since creation;
   *  null when no ID pair was found. */
  trailerIdMatches: boolean | null;
}

/** One ABN found in the document text and its verification outcome. The
 *  four states keep the ADR-0009 discipline: `unverified` (lookup could not
 *  run/complete) is a neutral non-signal, never conflated with
 *  `not_registered` (register answered: not on it). */
export interface DocumentAbnCheck {
  /** The 11 digits as printed (normalised, no spaces). */
  abn: string;
  status: "invalid_checksum" | "registered" | "not_registered" | "unverified";
  /** ABR legal entity name when registered, else null. */
  entityName: string | null;
}

/** Jurisdiction content-logic results. `textExtracted:false` means the
 *  content layer had nothing to read (scanned/image PDF, extraction failed)
 *  — not that the document has no ABNs. */
export interface DocumentContentSummary {
  jurisdiction: "au";
  textExtracted: boolean;
  abns: DocumentAbnCheck[];
}

/** Response of POST /api/document-check (multipart upload mode). */
export interface WebDocumentCheckResponse {
  checked: boolean;
  reason?: "scan_unavailable";
  mode: "upload";
  docSha256: string | null;
  structural: PdfStructuralSummary | null;
  findings: DocumentFinding[];
  /** Jurisdiction content-logic results. Null = "not assessed" (no pack ran
   *  for this request), never "clean". */
  content: DocumentContentSummary | null;
  disclaimer: string;
}
