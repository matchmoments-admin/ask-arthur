// Document Check Module — the single seam for document forensics.
//
// `inspectDocument(buffer)` is the interface every surface calls (web route,
// ScamChecker document mode, /api/v1/document-checks, evidence records).
// Behind it: the structural byte walk (pdf-forensics.ts), the derived named
// findings, and the content hash. The jurisdiction content-logic packs
// (AU: ABN / BSB / arithmetic) plug in behind this same seam in a follow-up
// PR — callers will not change when they land; `content` simply stops being
// null for supported jurisdictions.
//
// Invariants this seam owns so callers can't get them wrong:
// - findings are always derived from THE SAME structural summary returned;
// - the hash is of the exact bytes inspected;
// - `content: null` means "not assessed" (no pack ran), never "clean".

import { createHash } from "node:crypto";

import type {
  DocumentContentSummary,
  DocumentFinding,
  PdfStructuralSummary,
} from "@askarthur/types";
import { collectStructuralFindings, inspectPdfStructure } from "./pdf-forensics";
import { extractPdfText } from "./pdf-text";
import { runAuPack } from "./packs/au";

export {
  collectStructuralFindings,
  inspectPdfStructure,
  parsePdfDate,
} from "./pdf-forensics";
export { extractPdfText } from "./pdf-text";

export interface DocumentInspection {
  docSha256: string;
  structural: PdfStructuralSummary;
  findings: DocumentFinding[];
  /** Jurisdiction content-logic results — null when no pack was requested
   *  or the file wasn't scannable ("not assessed", never "clean"). */
  content: DocumentContentSummary | null;
}

export interface InspectDocumentOptions {
  /** Run a jurisdiction content-logic pack over the extracted text. Omit
   *  (or null) for the structural layer only. */
  jurisdiction?: "au" | null;
}

/** Inspect one uploaded document (PDF). The structural layer is pure and
 *  deterministic; the content layer (opt-in via `jurisdiction`) extracts
 *  text and runs free validators — checksum locally, ABR behind the
 *  `document_check` brake. Never throws. Non-PDF bytes report
 *  structural.isPdf=false with zero findings — the caller decides whether
 *  that's a 422. */
export async function inspectDocument(
  buffer: Buffer,
  opts: InspectDocumentOptions = {},
): Promise<DocumentInspection> {
  const structural = inspectPdfStructure(buffer);
  const findings = collectStructuralFindings(structural);

  let content: DocumentContentSummary | null = null;
  if (opts.jurisdiction === "au" && structural.isPdf) {
    const text = await extractPdfText(buffer);
    const pack = await runAuPack(text);
    content = pack.content;
    findings.push(...pack.findings);
  }

  return {
    docSha256: createHash("sha256").update(buffer).digest("hex"),
    structural,
    findings,
    content,
  };
}
