// Not-a-clone audit sample (#1238, decision #1233).
//
// The pre-classifier's is_clone=false verdict parks an alert in `detected`
// forever: the submit worklist only offers is_clone rows and the recheck
// worklist only monitoring/declined, so a false negative was final and
// invisible. This module lets the EXISTING daily submit lane
// (clone-watch-urlscan-submit) carry a random sample of those alerts to
// urlscan, so the false-negative rate is measured instead of assumed.
//
// How a sample moves (all SQL in supabase/migration-v330-*):
//   draw   — an operator marks the one-off baseline (~100, SQL); the lane marks
//            the weekly ~5% itself, once per UTC ISO week, when
//            FF_CLONE_WATCH_NOT_A_CLONE_AUDIT_WEEKLY is on.
//   submit — the lane lists un-tried samples and gives them up to
//            AUDIT_SLOTS_PER_RUN of its SUBMIT_BATCH_LIMIT slots. The batch
//            total does not grow, so neither does urlscan volume.
//   stamp  — every sample the lane tried (anything but a 429) is stamped, so an
//            unscannable row cannot re-present forever.
//   verdict— the retrieve lane persists the scan like any other; v307/v200 move
//            a likely_phishing verdict detected → weaponised (the miss is
//            re-opened by the existing guarded lifecycle RPC) and a benign one
//            detected → monitoring.
//   count  — clone_watch_not_a_clone_audit_summary() (#1237's scorecard input).

import type { CloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";

/** Of the submit lane's daily SUBMIT_BATCH_LIMIT (75), at most this many go to
 *  audit samples. The baseline 100 drains in 4 daily runs; a weekly draw
 *  (~20 rows at today's pool) in one. It displaces at most this many regular
 *  candidates for a day — they are not lost, the worklist re-offers them. */
export const AUDIT_SLOTS_PER_RUN = 25;

/** The weekly sample: this fraction of the never-scanned not-a-clone pool inside
 *  the horizon, minimum 1 when the pool is non-empty (decision #1233: "~5%"). */
export const WEEKLY_AUDIT_FRACTION = 0.05;

/** Same 90-day horizon as the submit and recheck worklists — an older domain is
 *  outside every lane, so the weekly sample does not reach for it. The one-off
 *  baseline has no horizon (it measures the whole stock). */
export const WEEKLY_AUDIT_HORIZON_DAYS = 90;

export interface SubmitBatchPlan {
  /** What the lane submits: regular candidates first, then audit samples. */
  candidates: CloneCandidate[];
  /** The audit-sample ids inside `candidates` (to stamp after the batch). */
  auditIds: number[];
}

/**
 * Compose the lane's batch from the regular gated worklist and the audit
 * samples. The total never exceeds `batchLimit` — samples take at most
 * `auditSlots`, regular candidates fill the rest. Samples go LAST: if the
 * wall-clock budget stops the loop early, the unreached tail is unstamped and
 * re-presents tomorrow, while the regular (time-sensitive) rows went first.
 */
export function composeSubmitBatch(
  regular: readonly CloneCandidate[],
  samples: readonly CloneCandidate[],
  batchLimit: number,
  auditSlots = AUDIT_SLOTS_PER_RUN,
): SubmitBatchPlan {
  const audit = samples.slice(0, Math.max(0, Math.min(auditSlots, batchLimit)));
  const auditIdSet = new Set(audit.map((c) => c.id));
  const reg = regular
    .filter((c) => !auditIdSet.has(c.id))
    .slice(0, Math.max(0, batchLimit - audit.length));
  return { candidates: [...reg, ...audit], auditIds: audit.map((c) => c.id) };
}

/** The audit samples the batch actually tried — `attemptedIds` from
 *  submitCandidateBatch already excludes 429s and unreached rows. */
export function attemptedAuditIds(
  attemptedIds: readonly number[],
  auditIds: readonly number[],
): number[] {
  const audit = new Set(auditIds);
  return attemptedIds.filter((id) => audit.has(id));
}

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export interface AuditLoad {
  samples: CloneCandidate[];
  /** Rows the weekly draw marked on this call (0 on six days of seven). */
  drawn: number;
  /** Set when a read failed; the lane then runs its regular batch unchanged. */
  error?: string;
}

/**
 * Draw this week's sample (when enabled) and list the un-tried samples.
 * Never throws: the audit is secondary to the lane's real job, and before v330
 * is applied both RPCs simply do not exist — the lane must keep submitting.
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
  const { data, error } = await sb.rpc("list_clone_not_a_clone_audit_pending", {
    p_limit: opts.limit ?? AUDIT_SLOTS_PER_RUN,
  });
  if (error) errors.push(`list: ${error.message}`);
  const samples = error ? [] : ((data as CloneCandidate[] | null) ?? []);
  return errors.length
    ? { samples, drawn, error: errors.join("; ") }
    : { samples, drawn };
}

/** Stamp the tried samples. Returns the count stamped, or null when the write
 *  failed (the SQL worklist also drops a row once urlscan evidence shows an
 *  attempt after the draw, so a failed stamp cannot loop a row forever). */
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
