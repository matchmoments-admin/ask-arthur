import type { BudgetClock } from "@askarthur/scam-engine/inngest/step-budget";
import { mapWithConcurrency } from "@askarthur/utils/concurrency";
import { isDomainGone } from "@/lib/clone-watch/liveness";

/**
 * Weaponised liveness sweep (v329, #1234) — "is the phishing site still there?"
 * for every alert in `weaponised`, by DNS only.
 *
 * WHY. Nothing rechecked a weaponised alert. The urlscan recheck lane admits
 * monitoring/declined only; the reconcile and issue worklists stop at a 30-day
 * submitted_at window. Measured 2026-09-26: 142 weaponised, 109 weaponised
 * more than 30 days ago, 5 with a recheck in the last 7 days — and a DNS read
 * of all 142 found 63 NXDOMAIN (54 of them in the >30-day tail). They were
 * counted as live phishing on every surface that reads `weaponised`.
 *
 * WHY DNS, NOT URLSCAN. urlscan's unlisted quota (60/min, 100/h) is already
 * spent by the recheck lane (~90 per :30 run) and pipeline-urlscan-enrichment,
 * and the lifecycle question is "does this name still exist", which is exactly
 * `isDomainGone` (NXDOMAIN on A and NS — the only honest "gone", liveness.ts).
 * 142 names at 16 in flight read in ~10 s.
 *
 * The same pass re-reads, weekly, every clone it moved to `dormant`: a lifted
 * registrar hold brings the site back, and it must re-enter as weaponised
 * (review #1254; lifecycle.ts TERMINAL_EXITS).
 *
 * The policy over these reads — first NXDOMAIN starts the clock, a second one
 * >= 12 h later confirms and moves the alert to `dormant` — lives in ONE place,
 * record_weaponised_liveness (v329). This module only reads.
 */

export const WEAPONISED_LIVENESS = {
  /** Per run. The whole weaponised set (142 today) fits in one run. */
  limit: 200,
  /** A row is re-read at most this often; < 24 so the 10:00/22:00 runs never
   *  skip a day on jitter. */
  cadenceHours: 20,
  /** Clones this sweep moved to dormant are re-read this often, so a lifted
   *  registrar hold is seen within a week (review #1254). */
  dormantCadenceHours: 168,
  /** Second NXDOMAIN must come at least this long after the first. */
  confirmHours: 12,
  /** DNS lookups in flight. */
  concurrency: 16,
} as const;

export interface LivenessTarget {
  id: number;
  candidate_domain: string;
  /** weaponised, or dormant for an offline clone being re-read. */
  lifecycle_state?: string;
}

export interface LivenessRead {
  id: number;
  /** true = NXDOMAIN (gone) · false = the name exists · null = proved nothing. */
  gone: boolean | null;
}

export interface LivenessSweep {
  reads: LivenessRead[];
  /** Targets the budget stopped before; they stay due and lead the next run. */
  unreached: number;
}

/**
 * Probe each target's domain, stopping when the budget expires. A probe that
 * throws reads as `null` (inconclusive) — never as gone.
 */
export async function readWeaponisedLiveness(
  targets: readonly LivenessTarget[],
  budget: Pick<BudgetClock, "expired">,
  probe: (host: string) => Promise<boolean | null> = isDomainGone,
): Promise<LivenessSweep> {
  const reads: LivenessRead[] = [];
  let unreached = 0;
  await mapWithConcurrency(
    targets,
    WEAPONISED_LIVENESS.concurrency,
    async (t) => {
      if (budget.expired()) {
        unreached++;
        return;
      }
      let gone: boolean | null;
      try {
        gone = await probe(t.candidate_domain);
      } catch {
        gone = null;
      }
      reads.push({ id: t.id, gone });
    },
  );
  return { reads, unreached };
}
