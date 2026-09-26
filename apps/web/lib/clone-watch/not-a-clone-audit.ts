// Not-a-clone audit sample (#1238, decision #1233).
//
// The pre-classifier's is_clone=false verdict parks an alert in `detected`
// forever: the submit worklist only offers is_clone rows and the recheck
// worklist only monitoring/declined, so a false negative was final and
// invisible. This module lets the EXISTING daily submit lane
// (clone-watch-urlscan-submit) carry a random sample of those alerts to
// urlscan, so the false-negative rate is measured instead of assumed.
//
// THE AUDIT IS MEASUREMENT. A miss is surfaced for human review and never
// acted on externally under the brand label the classifier rejected: v330's
// apply_clone_urlscan_verdict routes a sampled is_clone=false alert's
// likely_phishing verdict to `monitoring`, never `weaponised`, so no weaponised
// consumer (feed-platform, notify-weaponised, enforcement, Netcraft) is
// reachable. The lane logs one always-ship warn per miss (claimAuditMisses).
//
// How a sample moves (SQL in supabase/migration-v330-*):
//   draw    — an operator marks the one-off baseline (~100, SQL); the lane
//             marks the weekly ~5% itself, once per UTC ISO week, when
//             FF_CLONE_WATCH_NOT_A_CLONE_AUDIT_WEEKLY is on. fp rows excluded.
//   submit  — the lane lists `due` samples and runs them AFTER its regular
//             batch, in up to AUDIT_SLOTS_PER_RUN of its SUBMIT_BATCH_LIMIT.
//   attempt — every sample the lane tried (anything but a 429) gets
//             attempts+1; a sample with no verdict is re-offered every 168 h,
//             up to 3 attempts, then counts as unscannable.
//   verdict — the retrieve lane persists the scan; benign → monitoring (and a
//             weekly recheck), likely_phishing → monitoring + miss_at.
//   count   — clone_watch_not_a_clone_audit_summary() (#1237's input).

import type { CloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";

/** Of the submit lane's daily SUBMIT_BATCH_LIMIT (75), at most this many go to
 *  audit samples. Only ~33 regular rows were eligible on 2026-09-26, so in
 *  practice the samples fill otherwise-empty slots: they ADD up to this many
 *  urlscan submits a day (plus their retrieves) while samples are due. */
export const AUDIT_SLOTS_PER_RUN = 25;

/** The weekly sample: this fraction of the never-scanned not-a-clone pool inside
 *  the horizon, minimum 1 when the pool is non-empty (decision #1233: "~5%"). */
export const WEEKLY_AUDIT_FRACTION = 0.05;

/** Same 90-day horizon as the submit and recheck worklists — an older domain is
 *  outside every lane, so the weekly sample does not reach for it. The one-off
 *  baseline has no horizon (it measures the whole stock). */
export const WEEKLY_AUDIT_HORIZON_DAYS = 90;

export interface SubmitBatchPlan {
  /** Regular gated candidates, trimmed to the slots the samples leave. */
  regular: CloneCandidate[];
  /** Audit samples, capped at the audit slots; run AFTER `regular`. */
  audit: CloneCandidate[];
  /** Regular rows the worklist returned but this run could not take. */
  regularLeft: number;
}

/**
 * Split the lane's batch between the regular gated worklist (fetched at the
 * full SUBMIT_BATCH_LIMIT, so v285's oldest-rows reserve keeps its size) and
 * the audit samples. The total never exceeds `batchLimit`: samples take at most
 * `auditSlots`, the regular list is trimmed from its TAIL (the freshest rows,
 * which are still eligible tomorrow) to fit.
 */
export function composeSubmitBatch(
  regularFetched: readonly CloneCandidate[],
  samples: readonly CloneCandidate[],
  batchLimit: number,
  auditSlots = AUDIT_SLOTS_PER_RUN,
): SubmitBatchPlan {
  const regularIds = new Set(regularFetched.map((c) => c.id));
  const audit = samples
    .filter((c) => !regularIds.has(c.id))
    .slice(0, Math.max(0, Math.min(auditSlots, batchLimit)));
  const regular = regularFetched.slice(0, Math.max(0, batchLimit - audit.length));
  return { regular, audit, regularLeft: regularFetched.length - regular.length };
}

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export interface AuditMiss {
  alert_id: number;
  candidate_domain: string | null;
  candidate_url: string | null;
  cohort_key: string;
  model_id: string | null;
  confidence: number | null;
  miss_at: string;
}

export interface AuditLoad {
  samples: CloneCandidate[];
  /** Rows the weekly draw marked on this call (0 on six days of seven). */
  drawn: number;
  /** Misses recorded since the last run, claimed for the operator warn. */
  misses: AuditMiss[];
  /** Set when a call failed; the lane then runs its regular batch unchanged. */
  error?: string;
}

/**
 * Draw this week's sample (when enabled), claim new misses, and list the due
 * samples. Never throws: the audit is secondary to the lane's real job, and
 * before v330 is applied these RPCs do not exist — the lane must keep working.
 */
export async function loadAuditSamples(
  sb: RpcClient,
  opts: { drawWeekly: boolean; limit?: number },
): Promise<AuditLoad> {
  let drawn = 0;
  const errors: string[] = [];
  if (opts.drawWeekly) {
    const { data, error } = await sb.rpc("draw_clone_not_a_clone_audit_sample", {
      p_cohort: "weekly",
      p_fraction: WEEKLY_AUDIT_FRACTION,
      p_horizon_days: WEEKLY_AUDIT_HORIZON_DAYS,
    });
    if (error) errors.push(`draw: ${error.message}`);
    else drawn = typeof data === "number" ? data : 0;
  }
  const claimed = await sb.rpc("claim_clone_not_a_clone_audit_misses", {});
  if (claimed.error) errors.push(`misses: ${claimed.error.message}`);
  const misses = claimed.error ? [] : ((claimed.data as AuditMiss[] | null) ?? []);

  const { data, error } = await sb.rpc("list_clone_not_a_clone_audit_pending", {
    p_limit: opts.limit ?? AUDIT_SLOTS_PER_RUN,
  });
  if (error) errors.push(`list: ${error.message}`);
  const samples = error ? [] : ((data as CloneCandidate[] | null) ?? []);
  return errors.length
    ? { samples, drawn, misses, error: errors.join("; ") }
    : { samples, drawn, misses };
}

/** Record one attempt on each tried sample. Returns the count stamped, or null
 *  when the write failed (the SQL state also reads the urlscan evidence clock,
 *  so a lost stamp still waits out the 168 h cadence instead of looping). */
export async function stampAuditAttempts(
  sb: RpcClient,
  ids: readonly number[],
): Promise<number | null> {
  if (ids.length === 0) return 0;
  const { data, error } = await sb.rpc("mark_clone_not_a_clone_audit_attempted", {
    p_alert_ids: ids,
  });
  if (error) return null;
  return typeof data === "number" ? data : ids.length;
}
