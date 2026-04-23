// Provider 1/5: internal scam_reports + entities + clusters.
//
// Calls the v75 `phone_footprint_internal(p_msisdn_e164)` RPC and maps the
// aggregate counts into a 0-100 score. This is the only first-party pillar
// and carries the highest weight (0.30) because (a) it's Arthur's moat
// and (b) a phone number with 10+ user reports in the last 90 days is a
// stronger signal than any commercial reputation score.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { ProviderContract } from "../provider-contract";
import { unavailablePillar } from "../provider-contract";
import type { PillarResult } from "../types";

interface InternalResult {
  entity_id: number | null;
  entity_report_count: number;
  first_seen: string | null;
  last_seen: string | null;
  total_reports: number;
  high_risk_reports: number;
  suspicious_reports: number;
  distinct_scam_types: number;
  distinct_clusters: number;
  first_reported_at: string | null;
  last_reported_at: string | null;
  has_verified_scam: boolean;
  max_cluster_size: number;
}

/**
 * Score formula (see docs/plans/phone-footprint-v2.md §2):
 *   base_reports:   min(total_reports * 8, 50)
 *   high_risk_bump: min(high_risk_reports * 6, 30)
 *   cluster_bump:   min(max_cluster_size * 2, 15)
 *   verified_flag:  +20 if has_verified_scam (admin-curated)
 *   recency_bump:   +15 if last_reported_at within 14 days
 * Capped at 100. Chosen so a single user report ≈ 8 points (stays in band
 * 'safe'), 3 reports ≈ 24 (edge of 'caution'), 10+ high-risk reports →
 * 'critical'. Verified scams are rare and a strong prior.
 */
function scoreInternal(d: InternalResult): number {
  const recent = d.last_reported_at
    ? Date.now() - new Date(d.last_reported_at).getTime() < 14 * 86_400_000
    : false;

  const score =
    Math.min(d.total_reports * 8, 50) +
    Math.min(d.high_risk_reports * 6, 30) +
    Math.min(d.max_cluster_size * 2, 15) +
    (d.has_verified_scam ? 20 : 0) +
    (recent ? 15 : 0);

  return Math.min(100, score);
}

export const internalProvider: ProviderContract = {
  id: "internal-scam-db",
  timeoutMs: 1500,

  async run(msisdn: string): Promise<PillarResult> {
    const supa = createServiceClient();
    if (!supa) {
      return unavailablePillar("scam_reports", "supabase_unavailable");
    }

    const { data, error } = await supa.rpc("phone_footprint_internal", {
      p_msisdn_e164: msisdn,
    });
    if (error) {
      logger.warn("internal provider RPC failed", {
        error: String(error.message),
      });
      return unavailablePillar("scam_reports", "rpc_error");
    }

    const d = (data ?? {}) as InternalResult;
    const score = scoreInternal(d);

    return {
      id: "scam_reports",
      score,
      confidence: 1.0,
      available: true,
      detail: {
        entity_id: d.entity_id,
        entity_report_count: d.entity_report_count ?? 0,
        total_reports: d.total_reports ?? 0,
        high_risk_reports: d.high_risk_reports ?? 0,
        suspicious_reports: d.suspicious_reports ?? 0,
        distinct_scam_types: d.distinct_scam_types ?? 0,
        distinct_clusters: d.distinct_clusters ?? 0,
        max_cluster_size: d.max_cluster_size ?? 0,
        first_reported_at: d.first_reported_at,
        last_reported_at: d.last_reported_at,
        has_verified_scam: d.has_verified_scam === true,
      },
    };
  },
};
