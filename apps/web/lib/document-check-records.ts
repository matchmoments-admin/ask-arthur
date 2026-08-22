// Document-check evidence records — the ONE write path (ADR-0022 pattern).
//
// Both callers (the public /api/document-check route and the B2B
// /api/v1/document-checks POST) persist through this function so the
// invariants live in one place and can't drift per-surface:
// - RETENTION DIFFERS BY SOURCE, deliberately (2026-08-23):
//   * `web` — FLAGGED ONLY. An anonymous consumer never asked us to keep a
//     record of their clean document; ADR-0022's data-minimisation rule
//     applies in full.
//   * `api`  — EVERY check. A paying organisation is the data controller
//     for its own submissions and is buying an audit trail: "we checked
//     this applicant on this date and it came back clean" is the record a
//     property manager needs at a tribunal, and it's what every comparable
//     product (Snappt/ResMan deliver an authenticity report per applicant)
//     provides. Flagged-only would have made the GET feed a partial log
//     that silently omits most of what the customer paid for.
// - METADATA ONLY: a curated structural subset + findings + ABN register
//   facts — never document bytes, never extracted text (the abn_summary
//   digits are numbers the ABR publishes, not document content);
// - flag-gated by FF_DOCUMENT_CHECK_RECORDS, independent of the route flag;
// - the insert is AWAITED and the ref is returned only when the row exists:
//   a DC- ref is sold as quotable evidence (B2B pilots forward it to
//   tenants/tribunals), so a fire-and-forget write could hand out refs that
//   permanently 404 (PR #1031 review). Insert failure → null + error-level
//   log (always ships to Axiom).

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type { DocumentInspection } from "@askarthur/scam-engine/document-check";
import { generateCheckRef } from "@/lib/check-ref";

export interface RecordDocumentCheckContext {
  source: "web" | "api";
  orgId?: string | null;
  apiKeyHash?: string | null;
  /** Caller-supplied grouping key — the applicant / application / tenancy
   *  this document belongs to. The market's unit of work is the
   *  APPLICATION (3 payslips + a bank statement = one decision), not the
   *  document, so the B2B POST accepts it and the feed can group by it.
   *  Opaque to us: never parsed, never displayed as an identity. */
  caseRef?: string | null;
}

/** Persist a FLAGGED document check as a metadata-only evidence record.
 *  Returns the DC- checkRef only after the row is written; null when
 *  nothing is recorded (feature off, zero findings, no client, or the
 *  insert failed — a ref that would 404 is never handed out). Never
 *  throws. */
export async function recordDocumentCheck(
  inspection: DocumentInspection,
  ctx: RecordDocumentCheckContext,
): Promise<string | null> {
  if (!featureFlags.documentCheckRecords) return null;
  // See the retention note above: consumer surface keeps flagged checks
  // only; a paying org's own submissions are all kept as its audit trail.
  if (ctx.source === "web" && inspection.findings.length === 0) return null;
  const supabase = createServiceClient();
  if (!supabase) return null;

  const checkRef = generateCheckRef("DC");
  const s = inspection.structural;
  const record = {
    check_ref: checkRef,
    doc_sha256: inspection.docSha256,
    doc_type: null,
    jurisdiction: inspection.content?.jurisdiction ?? null,
    source: ctx.source,
    org_id: ctx.orgId ?? null,
    api_key_hash: ctx.apiKeyHash ?? null,
    case_ref: ctx.caseRef ?? null,
    // Curated subset — display-safe fields only, never extracted text.
    structural_summary: {
      pdfVersion: s.pdfVersion,
      byteLength: s.byteLength,
      incrementalUpdates: s.incrementalUpdates,
      startxrefCount: s.startxrefCount,
      linearized: s.linearized,
      encrypted: s.encrypted,
      producer: s.info.producer,
      creator: s.info.creator,
      creationDate: s.info.creationDate,
      modDate: s.info.modDate,
      xmpPresent: s.xmp.present,
      xmpHistoryEvents: s.xmp.historyEvents,
      trailerIdMatches: s.trailerIdMatches,
    },
    findings: inspection.findings,
    registry_checks: inspection.content?.checks ?? null,
  };

  try {
    const { error } = await supabase.from("document_check_records").insert(record);
    if (error) {
      logger.error("Failed to store document check record", {
        error: error.message,
        checkRef,
      });
      return null;
    }
  } catch (err) {
    logger.error("Failed to store document check record", {
      error: String(err),
      checkRef,
    });
    return null;
  }

  return checkRef;
}
