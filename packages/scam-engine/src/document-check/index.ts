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

import type { DocumentFinding, PdfStructuralSummary } from "@askarthur/types";
import { collectStructuralFindings, inspectPdfStructure } from "./pdf-forensics";

export {
  collectStructuralFindings,
  inspectPdfStructure,
  parsePdfDate,
} from "./pdf-forensics";

export interface DocumentInspection {
  docSha256: string;
  structural: PdfStructuralSummary;
  findings: DocumentFinding[];
  /** Jurisdiction content-logic results — null until a pack runs. */
  content: null;
}

/** Inspect one uploaded document (PDF). Pure and deterministic: no network,
 *  no paid APIs, never throws. Non-PDF bytes report structural.isPdf=false
 *  with zero findings — the caller decides whether that's a 422. */
export function inspectDocument(buffer: Buffer): DocumentInspection {
  const structural = inspectPdfStructure(buffer);
  return {
    docSha256: createHash("sha256").update(buffer).digest("hex"),
    structural,
    findings: collectStructuralFindings(structural),
    content: null,
  };
}
