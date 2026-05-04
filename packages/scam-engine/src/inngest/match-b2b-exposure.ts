// match-b2b-exposure — Phase 14 Sprint 4 consumer.
//
// Triggered by `b2b/exposure.requested.v1` events. Takes a customer's
// product/version inventory, finds matching CVEs in public.vulnerabilities,
// writes per-product matches into public.vulnerability_detections, then
// emits `b2b/exposure.matched.v1` for downstream webhook fan-out.
//
// Why this is the consumer (not the producer): the HTTP surface that turns
// an API request into the event lives in apps/web/app/api/v1/exposure/* and
// ships separately. Splitting that boundary lets the matcher run durably
// (Inngest retry + dedup) regardless of how the event was originated —
// REST, batch import, or admin-triggered backfill all hit the same path.
//
// Cost shape: pure DB. No LLM or paid-API calls. The semver scan is in-
// process JS over a bounded result set (idx_vuln_products GIN keeps the
// candidate set small). No cost-telemetry rows are emitted because there
// is nothing metered.

import semver from "semver";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

import { inngest } from "./client";
import {
  B2B_EXPOSURE_MATCHED_EVENT,
  B2B_EXPOSURE_REQUESTED_EVENT,
  parseB2bExposureRequestedData,
  type B2bExposureMatchedData,
  type ExposureMatch,
  type ExposureProduct,
} from "./events";
import { recordDetections, type DetectionCandidate } from "../vuln-detect";

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

export interface VulnerabilityRow {
  id: number;
  identifier: string;
  affected_products: unknown;
  affected_versions: unknown;
  severity: string | null;
  cvss_score: number | null;
  cisa_kev: boolean;
}

export interface MatchTriple {
  vuln: VulnerabilityRow;
  product: ExposureProduct;
}

/**
 * Walk a vuln's `affected_versions` JSONB and return true iff any entry's
 * `range` field is a semver expression that the supplied version satisfies.
 *
 * Schema: `affected_versions` is an array of `{range: string}` objects (the
 * shape v90 seeds). Future scrapers may store richer entries
 * ({introduced, fixed, lastAffected, ...}); for now we only honour `range`.
 * Unknown shapes return false so a malformed row can never produce a false
 * positive.
 */
export function versionMatches(
  product: ExposureProduct,
  affectedVersions: unknown,
): boolean {
  if (!Array.isArray(affectedVersions)) return false;
  const cleaned = semver.coerce(product.version);
  if (!cleaned) return false;

  for (const entry of affectedVersions) {
    if (!entry || typeof entry !== "object") continue;
    const range = (entry as { range?: unknown }).range;
    if (typeof range !== "string" || range.length === 0) continue;
    try {
      if (semver.satisfies(cleaned, range)) return true;
    } catch {
      // invalid range — skip
    }
  }
  return false;
}

export function meetsMinSeverity(
  rowSeverity: string | null,
  minSeverity: string,
): boolean {
  const rowRank = SEVERITY_RANK[rowSeverity ?? "info"] ?? 0;
  const minRank = SEVERITY_RANK[minSeverity] ?? 0;
  return rowRank >= minRank;
}

/**
 * Pure cross-product of products × candidate vulns, filtered by package
 * membership, version match, and minimum severity. Extracted so the
 * matching logic can be tested without invoking Inngest.
 */
export function filterMatches(
  candidates: VulnerabilityRow[],
  products: ExposureProduct[],
  minSeverity: string,
): MatchTriple[] {
  const triples: MatchTriple[] = [];
  for (const product of products) {
    for (const vuln of candidates) {
      const products = Array.isArray(vuln.affected_products)
        ? (vuln.affected_products as unknown[]).filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      if (!products.includes(product.name)) continue;
      if (!versionMatches(product, vuln.affected_versions)) continue;
      if (!meetsMinSeverity(vuln.severity, minSeverity)) continue;
      triples.push({ vuln, product });
    }
  }
  return triples;
}

/**
 * Build the summary `matches[]` for the matched.v1 event. Caps at 500
 * (schema limit) and sorts CISA KEV first, then CVSS score desc.
 */
export function buildMatchesPayload(triples: MatchTriple[]): ExposureMatch[] {
  return triples
    .slice(0, 500)
    .map(({ vuln, product }) => ({
      identifier: vuln.identifier,
      package: product.name,
      version: product.version,
      severity: vuln.severity,
      cvssScore: vuln.cvss_score,
      cisaKev: vuln.cisa_kev,
    }))
    .sort((a, b) => {
      if (a.cisaKev !== b.cisaKev) return a.cisaKev ? -1 : 1;
      return (b.cvssScore ?? 0) - (a.cvssScore ?? 0);
    });
}

export const matchB2bExposure = inngest.createFunction(
  {
    id: "match-b2b-exposure",
    name: "Vuln intel: match B2B product inventory against vulnerability DB",
    concurrency: { limit: 5 },
    // Throttle to keep the GIN query path cheap if a customer fans out
    // hundreds of requests. 200/min is well above expected steady-state.
    throttle: { limit: 200, period: "1m" },
    // Inngest dedup window — same requestId within 24h is a single execution.
    idempotency: "event.data.requestId",
  },
  { event: B2B_EXPOSURE_REQUESTED_EVENT },
  async ({ event, step }) => {
    if (!featureFlags.vulnB2bExposure) {
      return { skipped: true, reason: "ffVulnB2bExposure is off" };
    }

    const data = await step.run("parse-event", () =>
      parseB2bExposureRequestedData(event.data),
    );

    const productNames = Array.from(new Set(data.products.map((p) => p.name)));

    // Step 1 — fetch candidate vulns whose affected_products overlaps the
    // request. The `?|` operator (jsonb-array-contains-any-of-text) goes
    // through the `idx_vuln_products` GIN index.
    const candidates = await step.run("fetch-candidates", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [] as VulnerabilityRow[];

      const { data: rows, error } = await supabase
        .from("vulnerabilities")
        .select(
          "id, identifier, affected_products, affected_versions, severity, cvss_score, cisa_kev",
        )
        .overlaps("affected_products", productNames);

      if (error) {
        logger.error("match-b2b-exposure: candidate fetch failed", {
          requestId: data.requestId,
          orgId: data.orgId,
          error: error.message,
        });
        return [] as VulnerabilityRow[];
      }
      return (rows ?? []) as VulnerabilityRow[];
    });

    if (candidates.length === 0) {
      // Still emit the matched.v1 event so downstream webhook consumers
      // know the request has been processed (zero matches). Idempotent
      // empty-payload event keeps the contract uniform.
      await step.sendEvent("emit-matched-empty", {
        name: B2B_EXPOSURE_MATCHED_EVENT,
        id: `${data.requestId}-matched`,
        data: {
          requestId: data.requestId,
          orgId: data.orgId,
          matchCount: 0,
          matches: [],
          matchedAt: new Date().toISOString(),
        } satisfies B2bExposureMatchedData,
      });
      return { matched: 0, candidates: 0 };
    }

    // Step 2 — semver-filter the candidates against each product/version
    // tuple. A given vuln can match more than one product (e.g. monorepo
    // scopes), so the result is a flat list of (vuln, product, version)
    // triples.
    const matchTriples = filterMatches(
      candidates,
      data.products,
      data.minSeverity,
    );

    if (matchTriples.length === 0) {
      await step.sendEvent("emit-matched-empty-after-filter", {
        name: B2B_EXPOSURE_MATCHED_EVENT,
        id: `${data.requestId}-matched`,
        data: {
          requestId: data.requestId,
          orgId: data.orgId,
          matchCount: 0,
          matches: [],
          matchedAt: new Date().toISOString(),
        } satisfies B2bExposureMatchedData,
      });
      return { matched: 0, candidates: candidates.length };
    }

    // Step 3 — record detections. Inngest retries the step on failure, so
    // we don't need waitUntil here. recordDetections is idempotent (ON
    // CONFLICT DO NOTHING) so retries don't dupe rows.
    await step.run("record-detections", async () => {
      const detections: DetectionCandidate[] = matchTriples.map(
        ({ vuln, product }) => ({
          identifier: vuln.identifier,
          scanner: "scam-engine",
          targetType: "npm_package",
          targetValue: product.name,
          targetVersion: product.version,
          evidence: {
            orgId: data.orgId,
            requestId: data.requestId,
            cvssScore: vuln.cvss_score,
            severity: vuln.severity,
            cisaKev: vuln.cisa_kev,
          },
          scanId: data.requestId,
        }),
      );
      await recordDetections(detections);
    });

    // Step 4 — emit the summary event. matches[] is capped at 500 (matches
    // the schema limit); excess detections still live in the DB and can be
    // queried via /api/v1/exposure/* once that endpoint ships.
    const matches = buildMatchesPayload(matchTriples);

    await step.sendEvent("emit-matched", {
      name: B2B_EXPOSURE_MATCHED_EVENT,
      id: `${data.requestId}-matched`,
      data: {
        requestId: data.requestId,
        orgId: data.orgId,
        matchCount: matchTriples.length,
        matches,
        matchedAt: new Date().toISOString(),
      } satisfies B2bExposureMatchedData,
    });

    logger.info("match-b2b-exposure complete", {
      requestId: data.requestId,
      orgId: data.orgId,
      candidates: candidates.length,
      matches: matchTriples.length,
    });

    return { matched: matchTriples.length, candidates: candidates.length };
  },
);
