import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import type { AnalysisResult } from "@askarthur/types";
import { logCost } from "./cost-log";

// PR-A2 (docs/plans/checkout-guardrail-and-copytrading-defence.md): surface an
// "ASIC-listed" citation when an analyze submission mentions a domain on ASIC's
// Investor Alert List (regulator-confirmed unlicensed / impersonating investment
// entities — the TagMarkets / Sonic AI class). Shared by the web /api/analyze
// route AND runAnalysisCore (extension + bots) so the daily asic_investor scrape
// pays off in a real user check — a single source of truth, no per-surface drift.
//
// v1 is the high-precision DOMAIN signal: lookup_asic_investor_alert matches a
// stored ASIC domain appearing anywhere in the combined query text (plus exact
// name / alias). Catching a bare entity-NAME mention in free text (no URL) is a
// deliberate follow-up — it needs a reverse lookup with word-boundary FP gating,
// or false accusations land in a verdict. See the plan's PR-A2 notes.

export interface AsicCitation {
  entityName: string;
  alertType: string | null;
  asicUrl: string | null;
  /** 'name' | 'alias' | 'domain' | 'name_partial' */
  matchType: string;
}

// One row of lookup_asic_investor_alert(). createServiceClient() is untyped
// (no <Database> generic), so .rpc() returns `any` — type the rows explicitly.
interface AsicLookupRow {
  id: number;
  entity_name: string;
  alert_type: string | null;
  asic_url: string | null;
  domains: string[];
  match_type: string;
  is_active: boolean;
}

/**
 * Look up whether `query` mentions an ASIC-listed entity/domain.
 *
 * Never throws: any failure yields `null` (no citation), so this can sit on the
 * analyze hot path without adding a failure mode. A systemic lookup failure is
 * surfaced to the health-digest Telegram page via a $0 cost_telemetry error row.
 */
export async function checkAsicListed(
  query: string,
): Promise<AsicCitation | null> {
  const q = query?.trim();
  if (!q) return null;

  const sb = createServiceClient();
  if (!sb) return null;

  const { data, error } = await sb.rpc("lookup_asic_investor_alert", {
    p_query: q,
  });

  if (error) {
    logger.warn("checkAsicListed: query failed", { error: error.message });
    logCost({
      feature: "asic-lookup-error",
      provider: "supabase",
      operation: "lookup_asic_investor_alert",
      units: 1,
      estimatedCostUsd: 0,
      metadata: { error: error.message },
    });
    return null;
  }

  const rows = (data ?? []) as AsicLookupRow[];
  if (rows.length === 0) return null;
  // The RPC already orders is_active DESC; prefer an active row defensively.
  const top = rows.find((r) => r.is_active) ?? rows[0];
  return {
    entityName: top.entity_name,
    alertType: top.alert_type,
    asicUrl: top.asic_url,
    matchType: top.match_type,
  };
}

/**
 * If ASIC lookup is enabled and `query` matches an ASIC-listed entity, append a
 * red flag to `result` in place and return the citation (for the caller's own
 * observability). Self-gates on `featureFlags.asicLookup`; never throws.
 */
export async function applyAsicCitation(
  result: AnalysisResult,
  query: string,
  opts?: { requestId?: string },
): Promise<AsicCitation | null> {
  if (!featureFlags.asicLookup) return null;

  const hit = await checkAsicListed(query);
  if (!hit) return null;

  result.redFlags = [
    ...result.redFlags,
    `ASIC has flagged "${hit.entityName}" on its Investor Alert List as an ` +
      `unlicensed or impersonating entity. Do not invest, deposit funds, or ` +
      `pay any "fee" to withdraw.`,
  ];
  logger.info("analyze.asic_citation", {
    entity: hit.entityName,
    matchType: hit.matchType,
    requestId: opts?.requestId,
  });
  return hit;
}
