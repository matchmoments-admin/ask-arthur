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

function safeEvidence(input: Record<string, unknown> | undefined, identifier: string): Record<string, unknown> {
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

async function lookupVulnerabilityId(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  identifier: string
): Promise<number | null> {
  const cached = idCache.get(identifier);
  if (cached !== undefined) return cached;

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
    return null;
  }

  if (!data) return null;

  const id = data.id as number;
  idCache.set(identifier, id);
  return id;
}

/** Reset the in-process identifier→id cache. Test-only. */
export function __resetDetectionCacheForTests(): void {
  idCache.clear();
}

/**
 * Insert a single vulnerability_detections row. Fire-and-forget — never throws.
 * Callers should wrap in `waitUntil()` to keep the user response unblocked.
 */
export async function recordDetection(c: DetectionCandidate): Promise<void> {
  try {
    const supabase = createServiceClient();
    if (!supabase) {
      // Local dev without supabase env vars — silent no-op, matches the rest
      // of the scam-engine package.
      return;
    }

    const vulnerabilityId = await lookupVulnerabilityId(supabase, c.identifier);
    if (vulnerabilityId === null) {
      logger.warn("recordDetection: identifier not in vulnerabilities table", {
        identifier: c.identifier,
        scanner: c.scanner,
        targetType: c.targetType,
      });
      return;
    }

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
      }
    );

    if (error) {
      logger.error("recordDetection: insert failed", {
        identifier: c.identifier,
        scanner: c.scanner,
        targetValue: c.targetValue,
        error: error.message,
      });
    }
  } catch (err) {
    logger.error("recordDetection: unexpected failure", {
      identifier: c.identifier,
      error: String(err),
    });
  }
}

/**
 * Bulk variant. Each candidate is recorded independently — one bad row
 * doesn't fail the others. Sequential to keep error attribution clean and
 * because the typical batch is ≤4 rows per scan.
 */
export async function recordDetections(cs: DetectionCandidate[]): Promise<void> {
  for (const c of cs) {
    await recordDetection(c);
  }
}
