import { createServiceClient } from "@askarthur/supabase/server";
import { canonicaliseCandidateUrl, urlHash } from "@askarthur/shopfront-glue";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";

// Phase 2b (docs/plans/brand-convergence-seam.md): let the background clone-watch
// sweep pay off in a real user check. Given the URLs a user submitted to
// /api/analyze, find whether any is a CONFIRMED clone-watch alert and, if so,
// return a citation for a red flag.

export interface CloneAlertCitation {
  /** The clone domain the user checked (candidate_domain). */
  candidateDomain: string;
  /** The legitimate domain it impersonates (inferred_target_domain). */
  impersonatedDomain: string;
  /** ISO timestamp the clone was first flagged. */
  firstFlaggedAt: string;
}

// ONLY operator-confirmed true positives are trustworthy enough to surface to a
// user. Raw 'pending' / 'fp' / 'needs_investigation' lexical matches (~20% FP on
// day 1) must NEVER be cited — that would put false accusations in a verdict.
const CONFIRMED_STATUSES = ["tp_confirmed", "tp_actioned"] as const;

/** Extract a lowercased, www-stripped host from a URL or bare-host string.
 *  Exported for testing. */
export function hostOf(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let host: string;
  try {
    host = new URL(s.includes("://") ? s : `https://${s}`).hostname;
  } catch {
    return null;
  }
  return host.toLowerCase().replace(/^www\./, "") || null;
}

/**
 * Return a citation if any submitted URL is a CONFIRMED clone-watch alert.
 *
 * Matches by `url_hash` — the same `sha256Hex(canonicaliseCandidateUrl(host))`
 * the ingest writes — so it rides the existing `idx_clone_alerts_url_hash`
 * index (no sequential scan on the write-hot table, no new index). Never
 * throws: any failure just yields `null` (no citation), so this can sit in the
 * analyze hot path without adding a failure mode.
 */
export async function lookupCloneAlert(
  urls: string[],
): Promise<CloneAlertCitation | null> {
  const hosts = [
    ...new Set(urls.map(hostOf).filter((h): h is string => h !== null)),
  ];
  if (hosts.length === 0) return null;

  const hashes = await Promise.all(
    hosts.map((h) => urlHash(canonicaliseCandidateUrl(h))),
  );

  const sb = createServiceClient();
  if (!sb) return null;

  const { data, error } = await sb
    .from("shopfront_clone_alerts")
    .select("candidate_domain, inferred_target_domain, first_seen_at")
    .in("url_hash", hashes)
    .in("triage_status", CONFIRMED_STATUSES as unknown as string[])
    .not("inferred_target_domain", "is", null)
    .order("first_seen_at", { ascending: true })
    .limit(1);

  if (error) {
    logger.warn("lookupCloneAlert: query failed", { error: error.message });
    // Surface a systemic lookup failure to Telegram: the daily health-digest
    // cron pages on cost_telemetry rows whose feature matches '%error%'. $0 —
    // this is a DB read, not paid spend; the row is an error signal, not cost.
    logCost({
      feature: "clone-citation-error",
      provider: "supabase",
      operation: "lookup_clone_alert",
      units: 1,
      estimatedCostUsd: 0,
      metadata: { error: error.message },
    });
    return null;
  }
  const row = data?.[0];
  if (!row?.inferred_target_domain) return null;
  return {
    candidateDomain: row.candidate_domain as string,
    impersonatedDomain: row.inferred_target_domain as string,
    firstFlaggedAt: row.first_seen_at as string,
  };
}
