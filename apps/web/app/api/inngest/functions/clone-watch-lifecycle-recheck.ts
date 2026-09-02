import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { computeWeaponisationRisk } from "@/lib/clone-watch/weaponisation-risk";
import { submitCloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";

/**
 * Clone-Watch — lifecycle re-check loop (Wave 0 PR-B).
 *
 * The founder's "we need to press these somehow" ask, in code. Netcraft grades
 * on LIVE content, so a lookalike that is parked / cloaked / pre-weaponisation
 * at first scan comes back "no threats" (→ lifecycle 'declined') or benign
 * (→ 'monitoring'). Those domains very often weaponise LATER. This cron re-scans
 * the 'monitoring'/'declined' tail on a cadence: when the re-scan verdict flips
 * to likely_phishing, clone-watch-urlscan-retrieve promotes the alert to
 * 'weaponised' and emits shopfront/clone.weaponised.v1 — the contradiction we
 * exploit ("we saw the phish, Netcraft didn't").
 *
 * v224 (ops review): rescans are submitted INLINE here (one step.run per
 * candidate, mirroring clone-watch-urlscan-submit), NOT fanned out as 50
 * scan-requested events to scan-one — that fan-out was ~200 Inngest
 * invocations/day of the operator-single-click path. The daily throttle keeps
 * total rescans structurally bounded (the May-27 lesson); a manual-trigger
 * cooldown prevents same-hour stacking (which breached urlscan's 100/hour
 * unlisted cap). The retrieve stage picks up the fresh submissions (v224 also
 * fixed retrieve to see re-submitted-since-last-scan rows, so classified rows
 * that flip are finally detectable).
 *
 * Gated by FF_SHOPFRONT_CLONE_RECHECK (canary independently of Netcraft
 * submission) + a feature_brakes.shopfront_clone_recheck operator kill-switch.
 */

const RECHECK_BATCH_LIMIT = 50; // × 4 runs/day = ≤200 rescans/day, bounded
// F3: over-fetch the staleness-ordered pool, rank by weaponisation risk in TS
// (ONE scorer — weaponisation-risk.ts), rescan the top 50. Unselected rows keep
// their stale last_rechecked_at and rotate through on later runs.
//
// That rotation does NOT happen on its own. This comment used to claim
// "staleness-ordered pool → no starvation; full ~800-row rotation ≈ 4 days";
// measured in prod 2026-08-09, 108 pool rows had never been rechecked at all and
// 41 had gone >7.8 days. The pool is staleness-ordered but the SELECTION is
// risk-ordered, so a persistently low-risk row is fetched every run and picked
// never. selectTopRiskCandidates now reserves STALE_FLOOR_SHARE of each batch
// for the stalest rows, which is what actually bounds the rotation.
const RECHECK_FETCH_LIMIT = 200;
// Share of each batch reserved for the stalest rows regardless of risk score.
// 20% of 50 = 10 slots/run x 4 runs/day = 40 guaranteed rotations/day.
const STALE_FLOOR_SHARE = 0.2;
const RECHECK_CADENCE_HOURS = 6; // don't re-scan the same domain more often
// Break the submit loop before the 8m finish budget so worst-case urlscan
// latency can't force a full-batch re-POST; leftovers rotate next run.
const RECHECK_SUBMIT_WALL_CLOCK_MS = 400_000;
const BRAKE = "shopfront_clone_recheck";

interface RecheckRow {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  urlscan_classification: string | null;
  recheck_count: number;
  last_rechecked_at: string | null;
  // v222 risk-score inputs (all nullable — enrichment/classification partial).
  signals: unknown;
  attribution: {
    whois?: { createdDate?: string };
    ip_rep?: { abuseConfidenceScore?: number };
    au_registrant?: { abnStatus?: string; nameMatchesAbn?: boolean | null };
  } | null;
  clf_is_clone: boolean | null;
  clf_confidence: number | null;
  clf_attack_intent: string | null;
  clf_clone_tactic: string | null;
  brand_category: string | null;
}

type ScoredRow = RecheckRow & { risk: number };

/** Staleness ascending, nulls first, then id — the pool's own fetch order. */
function byStaleness(a: ScoredRow, b: ScoredRow): number {
  const ta = a.last_rechecked_at ? Date.parse(a.last_rechecked_at) : -Infinity;
  const tb = b.last_rechecked_at ? Date.parse(b.last_rechecked_at) : -Infinity;
  if (ta !== tb) return ta - tb;
  return a.id - b.id;
}

/**
 * Rank the fetched pool: risk desc, then staleness (asc, nulls first), then id —
 * deterministic. Exported for unit tests.
 *
 * STARVATION FLOOR. Risk sorts BEFORE staleness, and the pool is over-fetched
 * (RECHECK_FETCH_LIMIT rows ranked down to `limit`), so a persistently low-risk
 * row is fetched every run and selected never. The original comment on
 * RECHECK_FETCH_LIMIT asserted the opposite — "staleness-ordered pool → no
 * starvation; full ~800-row rotation ≈ 4 days" — and prod disagreed: 108 pool
 * rows had never been rechecked at all and 41 had gone more than 7.8 days,
 * against a claimed 4-day full rotation.
 *
 * So a fixed share of each batch is reserved for the stalest rows regardless of
 * risk. Every row therefore reaches the front of the staleness queue in bounded
 * time, while the large majority of the batch still goes to the risk ranking the
 * feature exists for. This is a floor, not a quota: if the risk-ranked selection
 * already contains the stalest rows, the reserve costs nothing.
 */
export function selectTopRiskCandidates(
  rows: RecheckRow[],
  limit: number,
  nowMs: number,
  // Proportional, deliberately NOT max(1, …): at a batch of 2 a one-slot reserve
  // would be half the run. The floor is a production-scale device — it is 0 below
  // a limit of 5 and 10 at the real batch size of 50.
  staleFloor: number = Math.floor(limit * STALE_FLOOR_SHARE),
): ScoredRow[] {
  const scored: ScoredRow[] = rows.map((r) => ({
    ...r,
    risk: computeWeaponisationRisk({
      urlscanClassification: r.urlscan_classification,
      signals: r.signals,
      isClone: r.clf_is_clone,
      confidence: r.clf_confidence,
      attackIntent: r.clf_attack_intent,
      brandCategory: r.brand_category,
      whoisCreatedDate: r.attribution?.whois?.createdDate ?? null,
      ipAbuseConfidenceScore: r.attribution?.ip_rep?.abuseConfidenceScore ?? null,
      auAbnStatus: r.attribution?.au_registrant?.abnStatus ?? null,
      auNameMatches: r.attribution?.au_registrant?.nameMatchesAbn ?? null,
      nowMs,
    }).score,
  }));

  const byRisk = [...scored].sort((a, b) => {
    if (a.risk !== b.risk) return b.risk - a.risk;
    return byStaleness(a, b);
  });

  const floor = Math.min(Math.max(0, staleFloor), limit);
  const chosen = new Map<number, ScoredRow>();
  for (const r of byRisk.slice(0, Math.max(0, limit - floor))) chosen.set(r.id, r);
  // Fill the reserve from the stalest end, then top back up from the risk order
  // if the reserve overlapped what risk already picked.
  for (const r of [...scored].sort(byStaleness)) {
    if (chosen.size >= limit) break;
    chosen.set(r.id, r);
  }
  for (const r of byRisk) {
    if (chosen.size >= limit) break;
    chosen.set(r.id, r);
  }

  // Return in risk order so the wall-clock guard spends the batch's early,
  // guaranteed-to-run slots on the highest-risk candidates.
  return [...chosen.values()].sort((a, b) => {
    if (a.risk !== b.risk) return b.risk - a.risk;
    return byStaleness(a, b);
  });
}

export const cloneWatchLifecycleRecheck = inngest.createFunction(
  {
    id: "shopfront-clone-lifecycle-recheck",
    name: "Clone-Watch: lifecycle re-check loop",
    retries: 1,
    concurrency: { limit: 1 },
    // Structural daily ceiling on inline urlscan submits (4 crons × 50 = 200
    // < 210), so a worklist regression / manual-trigger storm can't recreate
    // the May-27 urlscan burst (v224).
    throttle: { limit: 210, period: "1d" },
    // 15m, not 8m (#1069): the inline rescan step legitimately runs minutes
    // (50 rechecks incl. urlscan submits), and step boundaries now queue for
    // account-concurrency slots (~30–60s each under contention). Finite per
    // ADR-0019; guarded by inngestFinishBudgets.test.ts.
    // NOTE: this budget now exceeds the 10m pg-stuck-query-watchdog window.
    // That watchdog pages on a Postgres BACKEND running >=10 min; the long
    // pole here is external HTTP plus account-concurrency queue wait, not a
    // PG query, so a long run is expected and is not a watchdog condition
    // (CLAUDE.md requires documenting exactly this).
    timeouts: { finish: "15m" },
  },
  [
    // Offset from urlscan-retrieve (10 */3 since #1069) so a rescan submit and
    // a retrieve tick don't race on the same row (v224). The offset is 20 min,
    // narrowed from 30 when retrieve moved off the top of the hour.
    { cron: "30 */6 * * *" },
    { event: "shopfront/clone.lifecycle-recheck.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-lifecycle-recheck" },
    async ({ step }) => {
      if (!featureFlags.shopfrontCloneRecheck) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_RECHECK disabled" };
      }
      // The re-check loop's ONLY job is to trigger urlscan re-scans. If the
      // urlscan pipeline can't run, don't mark candidates rechecked (which would
      // bump last_rechecked_at and exclude them for a full cadence with no scan).
      if (!featureFlags.shopfrontCloneUrlscan) {
        return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
      }
      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }
      const braked = await step.run("check-brake", () => isFeatureBraked(BRAKE));
      if (braked) {
        return { skipped: true, reason: `feature_brakes.${BRAKE} engaged` };
      }

      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // Cooldown: skip if a recheck ran in the last 50 min. The 6h-apart crons
      // never trip this; it exists so rapid MANUAL triggers can't stack three
      // 50-submit runs into one hour and breach urlscan's 100/hour unlisted cap
      // (which happened 2026-07-12 00:00 UTC). The throttle is the structural
      // backstop; this is the operator-ergonomics one.
      const recentRun = await step.run("check-cooldown", async () => {
        const { data } = await sb
          .from("cost_telemetry")
          .select("created_at")
          .eq("feature", "shopfront_clone_recheck")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!data?.created_at) return false;
        return Date.now() - new Date(data.created_at).getTime() < 50 * 60 * 1000;
      });
      if (recentRun) {
        return { skipped: true, reason: "cooldown_active" };
      }

      const pool = await step.run("load-recheck-candidates", async () => {
        const { data } = await sb.rpc("list_clone_alerts_for_recheck", {
          p_limit: RECHECK_FETCH_LIMIT,
          p_cadence_hours: RECHECK_CADENCE_HOURS,
        });
        return (data as RecheckRow[] | null) ?? [];
      });

      if (pool.length === 0) {
        return { ok: true, rechecked: 0, reason: "nothing_due" };
      }

      // F3: rank the pool by weaponisation risk and rescan the top slice first.
      // Inside step.run so the ranking (which reads the clock for domain age)
      // is replay-stable.
      const candidates = await step.run("rank-by-risk", async () =>
        selectTopRiskCandidates(pool, RECHECK_BATCH_LIMIT, Date.now()),
      );

      // Submit every rescan inside ONE step instead of one step per candidate.
      // Inngest bills per step execution, so a 50-candidate batch was ~50
      // executions × 4 runs/day; a single batch step cuts that ~25×. urlscan
      // submit is idempotent (the submit-one helper records
      // urlscan_submitted_at, so a batch-step retry re-submits harmlessly and
      // the retrieve worklist de-dupes on it), so losing per-row memoisation is
      // safe. Each candidate is wrapped in try/catch so one failure doesn't
      // abort the rest; a failed row simply isn't marked submitted and is
      // retried next tick. Replaces the old 50-event fan-out to scan-one. A
      // wall-clock guard breaks before the 8m finish budget so worst-case submit
      // latency (50 × urlscan POST) can't force a full-batch re-POST — leftovers
      // stay unmarked and rotate through on the next run.
      const recheckSubmitStartMs = Date.now();
      const submitBatch = await step.run("submit-batch", async () => {
        let submitted = 0;
        let submitFailed = 0;
        let reputationHits = 0;
        for (const c of candidates) {
          if (Date.now() - recheckSubmitStartMs > RECHECK_SUBMIT_WALL_CLOCK_MS)
            break;
          try {
            const outcome = await submitCloneCandidate({
              id: c.id,
              candidate_url: c.candidate_url,
              candidate_domain: c.candidate_domain,
            });
            if (outcome.reputationMalicious) reputationHits++;
            if (
              outcome.kind === "submitted" ||
              outcome.kind === "reputation_classified"
            ) {
              submitted++;
            } else {
              submitFailed++;
            }
          } catch (err) {
            submitFailed++;
            logger.error("clone-watch recheck: submit failed", {
              alertId: c.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return { submitted, submitFailed, reputationHits };
      });
      const { submitted, submitFailed, reputationHits } = submitBatch;

      // Mark each candidate rechecked (bump recheck_count + last_rechecked_at)
      // so it drops out of the cadence window until the re-scan verdict lands.
      //
      // This used to call advance_clone_lifecycle with
      // `p_to_state: c.lifecycle_state` as a "no-op state change" — a value read
      // back in the load-candidates step, BEFORE submit-batch ran. Since #990 the
      // submit step can itself move a row declined -> weaponised, so the no-op
      // stopped being a no-op: it replayed a stale state and overwrote the
      // weaponisation the same run had just discovered. Caught in prod on alert
      // 2272 (`qantasa.exchange`) — weaponised 00:31:43, back to 'declined'
      // 00:32:13. weaponised_at survived (so the alert still fired) but every
      // count reads lifecycle_state, so it landed in the wrong bucket.
      //
      // v278's RPC takes an id and nothing else, so this step cannot name a
      // lifecycle state at all.
      await step.run("mark-rechecked", async () => {
        for (const c of candidates) {
          const { error } = await sb.rpc("mark_clone_alert_rechecked", {
            p_alert_id: c.id,
          });
          if (error) {
            throw new Error(
              `mark_clone_alert_rechecked failed for alert ${c.id}: ${error.message}`,
            );
          }
        }
      });

      // Two telemetry rows: the risk-score distribution (weight-tuning
      // feedstock) under the recheck feature, AND the urlscan submit VOLUME
      // under the urlscan feature — the recheck path is now the dominant
      // urlscan caller and was previously invisible to the cost dashboard /
      // volume ceilings (v224).
      await step.run("log-cost", async () => {
        const risks = candidates.map((c) => c.risk).sort((a, b) => a - b);
        logCost({
          feature: "shopfront_clone_recheck",
          provider: "internal",
          operation: "recheck_batch",
          units: candidates.length,
          unitCostUsd: 0,
          metadata: {
            rechecked: candidates.length,
            pool: pool.length,
            submitted,
            submit_failed: submitFailed,
            declined: candidates.filter((c) => c.lifecycle_state === "declined")
              .length,
            monitoring: candidates.filter(
              (c) => c.lifecycle_state === "monitoring",
            ).length,
            top_score: risks[risks.length - 1] ?? null,
            median_score: risks[Math.floor(risks.length / 2)] ?? null,
            bands: {
              critical: candidates.filter((c) => c.risk >= 70).length,
              elevated: candidates.filter((c) => c.risk >= 40 && c.risk < 70)
                .length,
              low: candidates.filter((c) => c.risk < 40).length,
            },
          },
        });
        logCost({
          feature: "shopfront_clone_urlscan",
          provider: "urlscan",
          operation: "recheck_submit",
          units: submitted,
          unitCostUsd: 0, // free tier
          metadata: { submitted, submit_failed: submitFailed, reputation_hits: reputationHits },
        });
      });

      logger.info("clone-watch lifecycle re-check: complete", {
        rechecked: candidates.length,
        pool: pool.length,
        submitted,
        submitFailed,
      });

      return {
        ok: true,
        rechecked: candidates.length,
        pool: pool.length,
        submitted,
        submitFailed,
      };
    },
  ),
);
