// Fire-and-forget recorder for `public.vulnerability_detections`.
//
// Scanners (mcp-audit, extension-audit, site-audit, skill-audit) call this
// after a scan completes to persist a per-target match. The helper looks up
// `vulnerability_id` from the canonical identifier (CVE / GHSA / custom) and
// inserts with ON CONFLICT DO NOTHING so replays of the same scan don't
// duplicate rows.
//
// Contract:
//   - Never throws. Failures are logged via @askarthur/utils/logger and
//     swallowed. Callers wrap in `waitUntil()` so the user response isn't
//     blocked on a DB write.
//   - Unknown identifier → warn + skip (no synthetic vulnerability rows).
//     The seed migration (v90) plus weekly scrapers are the only writers
//     to `public.vulnerabilities`.
//   - NULL/undefined targetVersion is coerced to "unknown" so the unique
//     constraint (vulnerability_id, target_type, target_value, target_version)
//     dedupes correctly. Postgres treats NULLs as distinct in unique indexes,
//     which would otherwise let dupes accumulate.
//   - evidence must be JSON-serializable. Non-serializable input (functions,
//     symbols, BigInt) is replaced with {} and logged.
//
// Caching: the identifier → vulnerability_id map is cached in-process for
// the lambda's lifetime. The cache is small (≤2000 rows expected) and
// vulnerabilities are append-mostly, so no TTL is needed — Vercel recycles
// the lambda often enough that stale entries can't accumulate.

import { createServiceClient } from "@askarthur/supabase/server";
import {
  DB_WRITE_CONCURRENCY,
  mapWithConcurrency,
  type WriteOutcome,
} from "@askarthur/utils/concurrency";

import type { BudgetClock } from "./inngest/step-budget";
import { logger } from "@askarthur/utils/logger";

export type DetectionScanner =
  | "mcp-audit"
  | "extension-audit"
  | "site-audit"
  | "scam-engine"
  | "skill-audit";

export type DetectionTargetType =
  | "url"
  | "extension"
  | "mcp_server"
  | "npm_package"
  | "skill";

export interface DetectionCandidate {
  /** CVE-2025-6514, GHSA-xxxx, MCP-2026-STDIO, etc. — must match `vulnerabilities.identifier`. */
  identifier: string;
  scanner: DetectionScanner;
  targetType: DetectionTargetType;
  /** Stable identifier for the scanned thing — package name, extension id, hostname, mcp_server url, skill path. */
  targetValue: string;
  /** Semver string, file hash, manifest version, etc. NULL/undefined → "unknown". */
  targetVersion?: string | null;
  /** Free-form per-detection context. Must be JSON-serializable. */
  evidence?: Record<string, unknown>;
  /** Correlation id back to the scan — site_audits.id, mcp_audits.id, request id, etc. */
  scanId?: string;
}

const idCache = new Map<string, number>();

function safeEvidence(
  input: Record<string, unknown> | undefined,
  identifier: string,
): Record<string, unknown> {
  if (!input) return {};
  try {
    return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  } catch (err) {
    logger.warn("recordDetection: evidence not JSON-serializable; using {}", {
      identifier,
      error: String(err),
    });
    return {};
  }
}

/**
 * Why this is discriminated rather than `number | null`.
 *
 * "The identifier is not in the vulnerabilities table" and "the lookup query
 * failed" both used to collapse to `null`, so the caller could not tell a
 * benign no-op from a database fault — and once recordDetections started
 * counting outcomes (#1134) that collapse would have booked every connection
 * reset as a benign skip, which is the silent-drop shape the Write Outcome
 * exists to prevent (CONTEXT.md).
 */
type VulnLookup =
  | { kind: "found"; id: number }
  | { kind: "not_found" }
  | { kind: "error" };

async function lookupVulnerabilityId(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  identifier: string,
): Promise<VulnLookup> {
  const cached = idCache.get(identifier);
  if (cached !== undefined) return { kind: "found", id: cached };

  const { data, error } = await supabase
    .from("vulnerabilities")
    .select("id")
    .eq("identifier", identifier)
    .maybeSingle();

  if (error) {
    logger.error("recordDetection: vulnerabilities lookup failed", {
      identifier,
      error: error.message,
    });
    return { kind: "error" };
  }

  if (!data) return { kind: "not_found" };

  const id = data.id as number;
  idCache.set(identifier, id);
  return { kind: "found", id };
}

/** Reset the in-process identifier→id cache. Test-only. */
export function __resetDetectionCacheForTests(): void {
  idCache.clear();
}

/**
 * What happened to one candidate. `skipped` is a BENIGN no-op — the identifier
 * is not in the vulnerabilities table, so there was nothing to link — and is
 * deliberately not folded into `failed`, which means "tried and did not land".
 */
export type DetectionResult = "written" | "skipped" | "failed";

/**
 * Insert a single vulnerability_detections row. Never throws.
 * Callers should wrap in `waitUntil()` to keep the user response unblocked.
 *
 * Returns what happened so a bulk caller can count it. It used to return
 * `void`, which meant recordDetections could report nothing at all about a
 * batch — the same silent-drop shape #1131 removed from four other write
 * loops (CONTEXT.md -> Write Outcome).
 */
export async function recordDetection(
  c: DetectionCandidate,
): Promise<DetectionResult> {
  try {
    const supabase = createServiceClient();
    if (!supabase) {
      // A missing service client is a FAULT, not a benign skip. Returning
      // "skipped" here would re-create one layer up exactly the collapse the
      // discriminated VulnLookup was added to remove: in a deploy with the
      // Supabase env vars missing or misnamed, every candidate books as a
      // benign skip and the batch reports written 0, failed 0, skipped N — a
      // clean-looking run that wrote nothing.
      logger.error("recordDetection: no service client", {
        identifier: c.identifier,
        scanner: c.scanner,
      });
      return "failed";
    }

    const lookup = await lookupVulnerabilityId(supabase, c.identifier);
    // A failed lookup is a failure, not a skip. It already logged its own
    // error, so this path adds no second log line.
    if (lookup.kind === "error") return "failed";
    if (lookup.kind === "not_found") {
      logger.warn("recordDetection: identifier not in vulnerabilities table", {
        identifier: c.identifier,
        scanner: c.scanner,
        targetType: c.targetType,
      });
      return "skipped";
    }
    const vulnerabilityId = lookup.id;

    const targetVersion = c.targetVersion ?? "unknown";
    const evidence = safeEvidence(c.evidence, c.identifier);

    const { error } = await supabase.from("vulnerability_detections").upsert(
      {
        vulnerability_id: vulnerabilityId,
        scanner: c.scanner,
        target_type: c.targetType,
        target_value: c.targetValue,
        target_version: targetVersion,
        evidence,
        scan_id: c.scanId ?? null,
      },
      {
        onConflict: "vulnerability_id,target_type,target_value,target_version",
        ignoreDuplicates: true,
      },
    );

    if (error) {
      logger.error("recordDetection: insert failed", {
        identifier: c.identifier,
        scanner: c.scanner,
        targetValue: c.targetValue,
        error: error.message,
      });
      return "failed";
    }
    return "written";
  } catch (err) {
    logger.error("recordDetection: unexpected failure", {
      identifier: c.identifier,
      error: String(err),
    });
    return "failed";
  }
}

/**
 * A Write Outcome (per-CANDIDATE units) plus the two things this write knows
 * about why a candidate did not land.
 *
 * The invariant, stated because this site departs from the plain one:
 *
 *     attempted - written - failed - skipped  =  notReached
 *
 * `skipped` is benign (no such identifier in the vulnerabilities table).
 * `notReached` is the budget stopping the loop, and is the one that matters:
 * unlike every other worklist in the fleet, THIS write is not self-healing.
 * The function is keyed `idempotency: event.data.requestId`, so a re-fire of
 * the same request is deduped rather than resumed — a detection dropped here
 * is dropped for good. Callers must treat notReached > 0 as an error-level
 * event, not a warning.
 */
export interface DetectionWriteOutcome extends WriteOutcome {
  /** Identifier absent from the vulnerabilities table — nothing to link. */
  skipped: number;
  /** Candidates the budget never got to. NOT recoverable — see above. */
  notReached: number;
}

/**
 * Bulk variant. Each candidate is recorded independently — one bad row
 * doesn't fail the others.
 *
 * BOUNDED PARALLELISM since #1134. The docblock used to justify sequential
 * writes with "the typical batch is ≤4 rows per scan", which is true of the
 * mcp-audit caller and false of match-b2b-exposure: there the batch is
 * products (≤1000) x overlapping CVEs, with no constant capping it, all
 * inside ONE step.run bounded by the route's 300s maxDuration. At ~30-80ms
 * per round trip that step could exceed the request budget and die as a 504
 * with no step output — then retry and die identically. Error attribution is
 * per-row in the log line, so it survives the concurrency unchanged.
 *
 * `budget` is optional so the mcp-audit caller (small batches, no step) is
 * unaffected. When supplied, candidates past the deadline are left unwritten
 * and counted in `notReached` rather than silently dropped.
 */
export async function recordDetections(
  cs: DetectionCandidate[],
  opts: { budget?: BudgetClock } = {},
): Promise<DetectionWriteOutcome> {
  let written = 0;
  let failed = 0;
  let skipped = 0;
  let reached = 0;

  await mapWithConcurrency(cs, DB_WRITE_CONCURRENCY, async (c) => {
    // Checked per item rather than per wave: abandoning work already in
    // flight would waste it, and a wave is only as short as its slowest row.
    if (opts.budget?.expired()) return;
    reached++;
    const outcome = await recordDetection(c);
    if (outcome === "written") written++;
    else if (outcome === "skipped") skipped++;
    else failed++;
  });

  return {
    attempted: cs.length,
    written,
    failed,
    skipped,
    notReached: cs.length - reached,
    deadlineHit: cs.length > reached,
  };
}
