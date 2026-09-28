import type { BudgetClock } from "@askarthur/scam-engine/inngest/step-budget";
import {
  isRegistryHold,
  livenessVerdictOf,
  probeDomainDns,
  sweepDomainDns,
  DNS_SWEEP_CONCURRENCY,
  type DnsProbe,
  type LivenessRecordVerdict,
} from "@/lib/clone-watch/liveness";

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
 * and the lifecycle question is "does this name still exist", which is the
 * Domain DNS State (liveness.ts): gone = NXDOMAIN on A and NS, the only honest
 * "gone". 142 names at 16 in flight read in ~10 s.
 *
 * WHAT IT STORES (v341, 2026-09-28). Each read carries the state's verdict
 * (`livenessVerdictOf`): `present` = RESOLVES TO AN ADDRESS, `no_host` = the
 * name exists and A/AAAA ANSWERED empty, `gone`, `inconclusive` (anything
 * unproven — incl. an address lookup that failed). Before v341 the
 * RPC re-derived `present` from `gone === false`, so a name with NS but no
 * A/AAAA was "present": a dormant clone with its A pulled re-entered
 * `weaponised`, and it counted in the reconcile lane's `stranded_live`. The
 * re-emergence monitor, month-end stock and the v326 dead-dormancy exit all
 * required an address — now the sweep does too. `gone` is still sent (the
 * pre-v341 RPC reads only it, so this code is safe on either side of the
 * migration), as is `hold` (the one TS registry-hold rule).
 *
 * The same pass re-reads, weekly, every clone it moved to `dormant`: a lifted
 * registrar hold brings the site back, and it must re-enter as weaponised
 * (review #1254; lifecycle.ts TERMINAL_EXITS).
 *
 * The policy over these reads — first NXDOMAIN starts the clock, a second one
 * >= 12 h later confirms and moves the alert to `dormant`; only a read with an
 * address brings a dormant clone back — lives in ONE place,
 * record_weaponised_liveness (v329, v341). This module only reads.
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
  /** DNS probes in flight — the shared sweep default. */
  concurrency: DNS_SWEEP_CONCURRENCY,
} as const;

export interface LivenessTarget {
  id: number;
  candidate_domain: string;
  /** weaponised, or dormant for an offline clone being re-read. */
  lifecycle_state?: string;
  /** Stored RDAP statuses (attribution.whois.statuses), v341's list RPC.
   *  Absent (pre-v341 RPC) → `hold` is sent as null and the RPC falls back to
   *  its own regex. */
  whois_statuses?: unknown;
}

export interface LivenessRead {
  id: number;
  /** The stored verdict — see livenessVerdictOf. What v341 applies. */
  verdict: LivenessRecordVerdict;
  /** true = NXDOMAIN (gone) · false = the name exists · null = proved nothing.
   *  The pre-v341 RPC's only input; kept so either side of the migration is
   *  safe. */
  gone: boolean | null;
  /** clientHold/serverHold on the stored statuses; null = not supplied. */
  hold: boolean | null;
}

export interface LivenessSweep {
  reads: LivenessRead[];
  /** Targets the budget stopped before; they stay due and lead the next run. */
  unreached: number;
}

/**
 * Probe each target's domain, stopping when the budget expires — the shared
 * `sweepDomainDns`. A probe that throws reads as `inconclusive` (gone null) —
 * never as gone.
 */
export async function readWeaponisedLiveness(
  targets: readonly LivenessTarget[],
  budget: Pick<BudgetClock, "expired">,
  probe: DnsProbe = probeDomainDns,
): Promise<LivenessSweep> {
  const { states, unreached } = await sweepDomainDns(
    targets,
    (t) => t.candidate_domain,
    {
      expired: () => budget.expired(),
      probe,
      concurrency: WEAPONISED_LIVENESS.concurrency,
    },
  );
  const reads: LivenessRead[] = [];
  targets.forEach((t, i) => {
    const state = states[i];
    if (!state) return;
    reads.push({
      id: t.id,
      verdict: livenessVerdictOf(state),
      gone: state.gone,
      hold: holdOf(t.whois_statuses),
    });
  });
  return { reads, unreached };
}

/** The TS hold rule over the list RPC's statuses; null when not supplied. */
function holdOf(statuses: unknown): boolean | null {
  if (!Array.isArray(statuses)) return null;
  return isRegistryHold(statuses.filter((s): s is string => typeof s === "string"));
}
