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
// Epistemics (2026-08-21 review of PR #1030 tightened all four):
// - A checksum-fail finding fires ONLY for LABELLED "ABN: …" matches. The
//   bare extractor matches any standalone 11-digit run (account numbers,
//   references, +61 phone formats) and ~99% of those fail mod-89 — accusing
//   them would amber-flag ordinary legitimate invoices. Bare candidates are
//   only ever *verified* (checksum survivors), never accused, and bare
//   checksum junk isn't listed at all.
// - A cancelled ABN is NOT "registered" — a real-but-inactive record must
//   not lend the document the register's credibility (the verifyShopAbn
//   status!=="active" precedent).
// - A failed LOOKUP is `unverified`, a neutral non-signal (the F-A bug
//   class, GitHub #349 / ADR-0009).
// - Lookups run in PARALLEL under a per-lookup deadline so a degraded ABR
//   can't hold this unauthenticated route open for tens of seconds.

import type {
  DocumentContentSummary,
  DocumentFinding,
} from "@askarthur/types";
import { extractAbnCandidatesDetailed, isValidAbnChecksum } from "../../abn-extract";
import { lookupABN } from "../../abr-lookup";
import { isFeatureBraked, logCost } from "../../cost-log";

/** Bound ABR calls per document — applied AFTER the checksum filter, so
 *  junk can't crowd a genuine candidate out of the slots. */
const MAX_ABN_LOOKUPS = 5;

/** Per-lookup deadline. Lookups run in parallel, so this is also the
 *  approximate worst-case wall clock the pack adds to the route. */
const LOOKUP_DEADLINE_MS = 4_000;

export interface AuPackResult {
  content: DocumentContentSummary;
  findings: DocumentFinding[];
}

function withDeadline<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), LOOKUP_DEADLINE_MS);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** Run the AU content-logic pack over extracted document text. `text: null`
 *  (extraction unavailable) reports textExtracted:false with no findings —
 *  never an accusation. */
export async function runAuPack(text: string | null): Promise<AuPackResult> {
  const content: DocumentContentSummary = {
    jurisdiction: "au",
    textExtracted: text !== null,
    checks: [],
  };
  const findings: DocumentFinding[] = [];
  if (text === null) return { content, findings };

  const { labelled, bare } = extractAbnCandidatesDetailed(text);
  if (labelled.length === 0 && bare.length === 0) return { content, findings };

  // Labelled checksum failures are the accusable case — the document
  // explicitly presents the number as an ABN.
  for (const abn of labelled) {
    if (!isValidAbnChecksum(abn)) {
      content.checks.push({ kind: "abn", identifier: abn, status: "invalid_checksum", entityName: null });
      findings.push({ signal: "abn_checksum_fail", evidence: { abn } });
    }
  }

  // Verification set: checksum survivors, labelled first, capped after the
  // filter so junk never occupies a lookup slot.
  const toVerify = [...labelled, ...bare]
    .filter(isValidAbnChecksum)
    .slice(0, MAX_ABN_LOOKUPS);
  if (toVerify.length === 0) return { content, findings };

  // Kill-switch shared with the rest of the Document Check feature: braked
  // means "accept checks, skip external lookups" — checksum stays free.
  if (await isFeatureBraked("document_check")) {
    for (const abn of toVerify) {
      content.checks.push({ kind: "abn", identifier: abn, status: "unverified", entityName: null });
    }
    return { content, findings };
  }

  const results = await Promise.all(
    toVerify.map((abn) =>
      withDeadline(lookupABN(abn), { ok: false as const, reason: "lookup-failed" as const }),
    ),
  );

  for (let i = 0; i < toVerify.length; i++) {
    const abn = toVerify[i]!;
    const result = results[i]!;
    if ("reason" in result) {
      if (result.reason === "not-found") {
        content.checks.push({ kind: "abn", identifier: abn, status: "not_registered", entityName: null });
        findings.push({ signal: "abn_not_registered", evidence: { abn } });
      } else {
        // lookup-failed / deadline: NOT evidence of anything (ADR-0009).
        content.checks.push({ kind: "abn", identifier: abn, status: "unverified", entityName: null });
      }
      continue;
    }
    // Free API — log units at $0 for volume visibility, but ONLY on a real
    // upstream call (the cost-log contract): cache hits carry cached:true.
    if (!result.cached) {
      void logCost({
        feature: "document_check",
        provider: "abr",
        operation: "abn-lookup",
        units: 1,
        estimatedCostUsd: 0,
        metadata: { surface: "document_check_web" },
      });
    }
    if (result.status.toLowerCase() !== "active") {
      content.checks.push({ kind: "abn", identifier: abn, status: "cancelled", entityName: result.entityName });
      findings.push({ signal: "abn_cancelled", evidence: { abn } });
      continue;
    }
    content.checks.push({ kind: "abn", identifier: abn, status: "registered", entityName: result.entityName });
  }

  return { content, findings };
}
