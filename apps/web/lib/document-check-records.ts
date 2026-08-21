// Document-check evidence records — the ONE write path (ADR-0022 pattern).
//
// Both callers (the public /api/document-check route and the B2B
// /api/v1/document-checks POST) persist through this function so the
// invariants live in one place and can't drift per-surface:
// - FLAGGED ONLY: a record exists only when the check produced findings;
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
  if (inspection.findings.length === 0) return null;
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
    abn_summary: inspection.content?.abns ?? null,
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
