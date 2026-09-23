/**
 * Bounded, non-terminal Netcraft deferral — the ONE caller of the v248/v252
 * deferral RPCs.
 *
 * Both Netcraft lanes defer an alert instead of dropping it when it can't be
 * filed today (proved-dead host, unavailable/transient url_state, a "not yet
 * processed" reject). Each call bumps `rounds.<reason>` under the lane's own
 * `submitted_to` key; past `maxRounds` the RPC converts the alert to a terminal
 * `skipped: <reason>_exhausted`, so nothing loops forever.
 *
 * The two lanes deliberately keep different values — this module states them
 * side by side so the difference is visible, not accidental:
 *
 *  - issue (v248, `submitted_to.netcraft_issue`): dead hosts recheck every 72h
 *    and unavailable/transient every 24h. Rounds are counted PER REASON, so
 *    exhaustion lands at 5 × 72h ≈ 15 days (dead) or 5 × 24h ≈ 5 days
 *    (unavailable/transient) — both inside the issue worklist's 30-day
 *    `submitted_at` window, which bounds the lane regardless. A failed RPC
 *    THROWS: the step retries, and a lost deferral would re-present the row.
 *  - resubmit (v252, `submitted_to.netcraft_resubmit`): dead hosts recheck
 *    every 7 days, so exhaustion means ~35 days continuously NXDOMAIN — this
 *    worklist has no 30-day upper window to bound it. A failed RPC WARNS and
 *    defers nothing: the batch's live rows are still worth filing today.
 *
 * Runs inside the caller's existing step — it adds no step boundary.
 */
import type { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

const HOUR_MS = 3600 * 1000;

export const NETCRAFT_DEFERRAL = {
  issue: {
    rpc: "defer_clone_alert_netcraft_issue",
    maxRounds: 5,
    onError: "throw",
    deadRecheckMs: 72 * HOUR_MS,
    unavailableRecheckMs: 24 * HOUR_MS,
    transientRecheckMs: 24 * HOUR_MS,
  },
  resubmit: {
    rpc: "defer_clone_alert_netcraft_resubmit",
    maxRounds: 5,
    onError: "warn",
    deadRecheckMs: 7 * 24 * HOUR_MS,
  },
} as const;

export type NetcraftDeferralLane = keyof typeof NETCRAFT_DEFERRAL;

/**
 * Defers `ids` for `reason` until now + `recheckAfterMs`. Returns the RPC's
 * deferred count (0 for an empty list, or when the lane's policy is `warn` and
 * the RPC failed). Throws on RPC failure when the lane's policy is `throw`.
 */
export async function deferNetcraftAlerts(
  sb: Sb,
  lane: NetcraftDeferralLane,
  ids: number[],
  reason: string,
  recheckAfterMs: number,
  now: number = Date.now(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const policy = NETCRAFT_DEFERRAL[lane];
  const { data, error } = await sb.rpc(policy.rpc, {
    p_alert_ids: ids,
    p_reason: reason,
    p_recheck_after: new Date(now + recheckAfterMs).toISOString(),
    p_max_rounds: policy.maxRounds,
  });
  if (error) {
    const message = `${policy.rpc}(${reason}) failed (${ids.length} alerts): ${error.message}`;
    if (policy.onError === "throw") throw new Error(message);
    // Loud, because a silent failure here IS the starvation (v252).
    logger.warn(`netcraft-${lane}: deferral failed`, {
      error: error.message,
      reason,
      alertIds: ids,
    });
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
