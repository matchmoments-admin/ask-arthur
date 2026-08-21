// AU jurisdiction pack — content-logic validators for Australian documents.
//
// First (and currently only) adapter at the Document Check Module's pack
// seam. Jurisdiction-as-data per NORTH_STAR: a UK/NZ pack later is a new
// file here, zero core change. v1 scope is the ABN chain — extract printed
// ABNs, checksum-gate them (pure, free), then verify survivors against the
// ABR (free API, 24h Redis cache, ADR-0009 discriminated results). BSB
// validation is deliberately deferred to the AusPayNet-directory ingest
// decision: a hand-typed bank-prefix table would risk exactly the false
// accusations the copy table is engineered to prevent. Arithmetic/YTD
// consistency needs layout-aware extraction — also deferred.
//
// Epistemics: findings fire only on the two defensible states —
// mathematically-impossible ABN (checksum) and register-answered-not-found
// (ABR). A failed LOOKUP is `unverified`, a neutral non-signal (the F-A
// bug class, GitHub #349 / ADR-0009).

import type {
  DocumentAbnCheck,
  DocumentContentSummary,
  DocumentFinding,
} from "@askarthur/types";
import { extractAbnCandidates, isValidAbnChecksum } from "../../abn-extract";
import { lookupABN } from "../../abr-lookup";
import { isFeatureBraked, logCost } from "../../cost-log";

/** Bound ABR calls per document — a page of junk 11-digit runs must not
 *  turn one upload into dozens of lookups. */
const MAX_ABN_LOOKUPS = 5;

export interface AuPackResult {
  content: DocumentContentSummary;
  findings: DocumentFinding[];
}

/** Run the AU content-logic pack over extracted document text. `text: null`
 *  (extraction unavailable) reports textExtracted:false with no findings —
 *  never an accusation. */
export async function runAuPack(text: string | null): Promise<AuPackResult> {
  const content: DocumentContentSummary = {
    jurisdiction: "au",
    textExtracted: text !== null,
    abns: [],
  };
  const findings: DocumentFinding[] = [];
  if (text === null) return { content, findings };

  const candidates = extractAbnCandidates(text).slice(0, MAX_ABN_LOOKUPS);
  if (candidates.length === 0) return { content, findings };

  // Kill-switch shared with the rest of the Document Check feature: braked
  // means "accept checks, skip external lookups" — checksum stays free.
  const braked = await isFeatureBraked("document_check");

  for (const abn of candidates) {
    if (!isValidAbnChecksum(abn)) {
      content.abns.push({ abn, status: "invalid_checksum", entityName: null });
      findings.push({ signal: "abn_checksum_fail", evidence: { abn } });
      continue;
    }
    if (braked) {
      content.abns.push({ abn, status: "unverified", entityName: null });
      continue;
    }
    const result = await lookupABN(abn);
    // Free API — still log units at $0 so volume/ceiling stays visible.
    void logCost({
      feature: "document_check",
      provider: "abr",
      operation: "abn-lookup",
      units: 1,
      estimatedCostUsd: 0,
      metadata: { surface: "document_check_web" },
    });
    if ("reason" in result) {
      if (result.reason === "not-found") {
        content.abns.push({ abn, status: "not_registered", entityName: null });
        findings.push({ signal: "abn_not_registered", evidence: { abn } });
      } else {
        // lookup-failed: NOT evidence of anything (ADR-0009).
        content.abns.push({ abn, status: "unverified", entityName: null });
      }
      continue;
    }
    content.abns.push({
      abn,
      status: "registered",
      entityName: result.entityName,
    } satisfies DocumentAbnCheck);
  }

  return { content, findings };
}
