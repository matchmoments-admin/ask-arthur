import { isFeatureBrakedOrUnknown } from "@askarthur/scam-engine/cost-log";
import { LANES, recordLaneError, recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { inngest } from "@askarthur/scam-engine/inngest/client";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { logCostAsync } from "@/lib/cost-telemetry";
import {
  computeWeaponisationRisk,
  riskBand,
} from "@/lib/clone-watch/weaponisation-risk";
import { submitCandidateBatch } from "@/lib/clone-watch/urlscan-submit-one";
import { attributionRiskInputs } from "@/lib/clone-watch/attribution";
import { laneCrons, laneGate } from "@/lib/laneHealth";

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

// × 4 runs/day = ≤360 rescans/day. Bounded by urlscan's UNLISTED quota —
// 100/hour, 1,000/day (/user/quotas, read 2026-09-26): one batch lands inside
// one hour, so 90 leaves 10 of the hour for any other unlisted caller. Was 50
// (#1231): 50/50 on every run since 2026-09-17 with 1,420 rows due.
//
// This does NOT meet the designed cadence and cannot: at 6h/24h/168h the pool
// asks for ~3,800 rescans/day, ~4x the whole daily quota. `due_total` in the
// Outcome Row makes the gap visible; the fix is change-triggered rescans (a
// free DNS fingerprint gates the urlscan call — #1229), not a bigger cap.
export const RECHECK_BATCH_LIMIT = 90;
// Submits in flight inside the batch step, PACED: urlscan's unlisted cap is
// 60/min and a sequential submit is ~1.5–2.2 s (measured), so width alone
// would push ~80/min. One start per 1.1 s holds it near 55/min; width 3 hides
// each row's latency so the pacing, not the latency, sets the rate. 90 rows
// ≈ 100 s, inside RECHECK_SUBMIT_WALL_CLOCK_MS.
const RECHECK_SUBMIT_CONCURRENCY = 3;
const RECHECK_SUBMIT_MIN_INTERVAL_MS = 1_100;
// Same-window cooldown for a manual fire. 65 min, not 50: the unlisted quota
// is 100/HOUR, and two batches of 90 inside one hour is 180 (at 50/batch a
// 51-minute stack was 100 and just fit).
const RECHECK_COOLDOWN_MS = 65 * 60 * 1000;
// F3: over-fetch the staleness-ordered pool, rank by weaponisation risk in TS
// (ONE scorer — weaponisation-risk.ts), rescan the top RECHECK_BATCH_LIMIT. Unselected rows keep
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
// 20% of 90 = 18 slots/run x 4 runs/day = 72 guaranteed rotations/day.
const STALE_FLOOR_SHARE = 0.2;
const RECHECK_CADENCE_HOURS = 6; // don't re-scan the same domain more often
// Break the submit loop before the ROUTE's maxDuration — the loop runs inside
// ONE step, so Vercel's 300s request kill is the bound that applies, not the
// 15m finish budget (step-budget.ts). In-step: the clock starts at step entry.
// Was 400_000 as a spanning budget measured from event.ts (#1124–#1130), which
// is the wrong constructor for a single-step loop and above budgetedStep's 240s
// ceiling; the :30 cron never sat on the fleet pileup so it happened not to
// expire at index 0 the way the 09:00 submit lane did. Leftovers rotate next run.
const RECHECK_SUBMIT_WALL_CLOCK_MS = 220_000;
const BRAKE = LANES["shopfront-clone-lifecycle-recheck"].brake;

interface RecheckRow {
  id: number;
  /** v328: rows due in total (window count before the LIMIT). */
  due_total?: number | string | null;
  candidate_domain: string;
  candidate_url: string;
  lifecycle_state: string;
  urlscan_classification: string | null;
  recheck_count: number;
  last_rechecked_at: string | null;
  // v222 risk-score inputs (all nullable — enrichment/classification partial).
  signals: unknown;
  /** attribution jsonb — read via attributionRiskInputs, never destructured. */
  attribution: unknown;
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
      ...attributionRiskInputs(r.attribution),
      nowMs,
    }).score,
  }));

  const byRisk = [...scored].sort((a, b) => {
    if (a.risk !== b.risk) return b.risk - a.risk;
    return byStaleness(a, b);
  });

  const floor = Math.min(Math.max(0, staleFloor), limit);
  const chosen = new Map<number, ScoredRow>();
  for (const r of byRisk.slice(0, Math.max(0, limit - floor)))
    chosen.set(r.id, r);
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
    // Inngest throttle counts RUNS, not submits: this caps runs/day. The
    // submit ceiling is RECHECK_BATCH_LIMIT per run × the 65-min cooldown,
    // which keeps a manual-trigger storm from recreating the May-27 urlscan
    // burst (v224).
    throttle: { limit: 210, period: "1d" },
    // 15m, not 8m (#1069): the inline rescan step legitimately runs minutes
    // (a batch of rechecks incl. urlscan submits), and step boundaries now queue for
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
    ...laneCrons("shopfront-clone-lifecycle-recheck"),
    { event: "shopfront/clone.lifecycle-recheck.manual-trigger.v1" },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-lifecycle-recheck" },
    async ({ step }) => {
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("shopfront-clone-lifecycle-recheck");
      if (!gate.ok) return { skipped: true, reason: gate.reason };
      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }
      const braked = await step.run("check-brake", () =>
        isFeatureBrakedOrUnknown(BRAKE),
      );
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
        return (
          Date.now() - new Date(data.created_at).getTime() < RECHECK_COOLDOWN_MS
        );
      });
      if (recentRun) {
        return { skipped: true, reason: "cooldown_active" };
      }

      // The worklist holds out never-scanned dead rows (v326: no uuid, 400
      // status, failure streak >= 8); the same step reads how many, so the
      // exclusion is counted in the Outcome Row instead of being silent
      // (worklist-gate-starvation rule). A failed count reads as null, never 0.
      const loaded = await step.run("load-recheck-candidates", async () => {
        const [{ data, error }, dormant] = await Promise.all([
          sb.rpc("list_clone_alerts_for_recheck", {
            p_limit: RECHECK_FETCH_LIMIT,
            p_cadence_hours: RECHECK_CADENCE_HOURS,
          }),
          sb.rpc("count_clone_recheck_dormant_dead"),
        ]);
        // A failed worklist read must not look like a quiet "nothing due" run
        // (that is exactly how a broken read hides) — record it and throw.
        if (error) {
          await recordLaneError("shopfront-clone-lifecycle-recheck", error.message);
          throw new Error(`list_clone_alerts_for_recheck failed: ${error.message}`);
        }
        return {
          rows: (data as RecheckRow[] | null) ?? [],
          dormantDead:
            !dormant.error && typeof dormant.data === "number" ? dormant.data : null,
        };
      });
      // A run memoised before this step returned an object replays the array.
      const pool: RecheckRow[] = Array.isArray(loaded) ? loaded : loaded.rows;
      // v328: every worklist row carries the full due count (count(*) OVER ()
      // before the LIMIT), so the backlog the cap leaves is on record.
      const dueRaw = pool[0]?.due_total;
      const dueTotal: number | null =
        dueRaw == null || !Number.isFinite(Number(dueRaw)) ? null : Number(dueRaw);
      const dormantDead: number | null = Array.isArray(loaded) ? null : loaded.dormantDead;

      if (pool.length === 0) {
        // Quiet-run Outcome Row (#1145/#1166): "nothing due" used to write
        // nothing and read as "not running". The 65-min cooldown above reads
        // this feature's latest row, so a quiet run also holds off a stacked
        // manual fire — intended.
        await step.run("log-cost-quiet", () =>
          recordLaneOutcome("shopfront-clone-lifecycle-recheck", 0, {
            reason: "nothing_due",
            pool: 0,
            rechecked: 0,
            submitted: 0,
            submit_failed: 0,
            dormant_dead: dormantDead,
          }),
        );
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
      // wall-clock guard breaks before the 15m finish budget so worst-case submit
      // latency (50 × urlscan POST) can't force a full-batch re-POST — leftovers
      // stay unmarked and rotate through on the next run. The loop does NOT
      // await step.run per item, so this is an in-step budget, not a spanning
      // one (step-budget.ts).
      const submitBatch = await budgetedStep(
        step,
        "submit-batch",
        RECHECK_SUBMIT_WALL_CLOCK_MS,
        // attemptedIds is every row the loop LOOKED AT, except a 429. The
        // cadence stamp (mark_clone_alert_rechecked) records "we looked", not
        // "it worked": a submit that urlscan refused with a 400 (no DNS) is
        // exactly the row v277's 168h dead-domain cadence exists to park, and
        // that cadence keys on last_rechecked_at. #1127 stamped only successes,
        // so every failed row kept its stale stamp, stayed at the head of the
        // staleness-ordered worklist, and was re-attempted 4×/day — within a
        // week the same 50 dead domains were the whole batch and the live tail
        // went unrechecked (worklist-gate-starvation rule). A 429 is the one
        // exception: quota exhaustion says nothing about the URL, and leaving
        // it unstamped means the next run retries it as soon as the quota is
        // back (v224). It is counted as rate_limited, NOT submit_failed — this
        // lane used to fold it into failures, so a quota day paged the health
        // digest as silent_zero (2026-09-24). The mapping now lives in ONE
        // place, shared with the daily submit lane.
        async (budget) =>
          submitCandidateBatch(candidates, budget, {
            concurrency: RECHECK_SUBMIT_CONCURRENCY,
            minStartIntervalMs: RECHECK_SUBMIT_MIN_INTERVAL_MS,
            onRowError: (alertId, err) =>
              logger.error("clone-watch recheck: submit failed", {
                alertId,
                error: err instanceof Error ? err.message : String(err),
              }),
          }),
      );
      const {
        submitted,
        submitFailed,
        rateLimited,
        dnsSkipped,
        dnsServfail,
        reputationHits,
        attemptedIds,
        unreached,
      } = submitBatch;

      // Mark every attempted candidate rechecked (bump recheck_count +
      // last_rechecked_at) so it drops out of the cadence window — 6h for a
      // live domain, 168h for one urlscan refused — until its turn comes round.
      // Rows the budget skipped and rows urlscan rate-limited stay unstamped
      // and re-present next run.
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
        for (const id of attemptedIds) {
          const { error } = await sb.rpc("mark_clone_alert_rechecked", {
            p_alert_id: id,
          });
          if (error) {
            throw new Error(
              `mark_clone_alert_rechecked failed for alert ${id}: ${error.message}`,
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
        await recordLaneOutcome(
          "shopfront-clone-lifecycle-recheck",
          attemptedIds.length,
          {
            rechecked: attemptedIds.length,
            pool: pool.length,
            submitted,
            submit_failed: submitFailed,
            dns_skipped: dnsSkipped,
            dns_servfail: dnsServfail,
            rate_limited: rateLimited,
            unreached,
            dormant_dead: dormantDead,
            // #1231: the cap, whether this run hit it, and the true due count
            // (v328 window count; null = older RPC / not returned).
            cap: RECHECK_BATCH_LIMIT,
            cap_reached: candidates.length >= RECHECK_BATCH_LIMIT,
            due_total: dueTotal,
            declined: candidates.filter((c) => c.lifecycle_state === "declined")
              .length,
            monitoring: candidates.filter(
              (c) => c.lifecycle_state === "monitoring",
            ).length,
            top_score: risks[risks.length - 1] ?? null,
            median_score: risks[Math.floor(risks.length / 2)] ?? null,
            bands: {
              critical: candidates.filter((c) => riskBand(c.risk) === "critical")
                .length,
              elevated: candidates.filter((c) => riskBand(c.risk) === "elevated")
                .length,
              low: candidates.filter((c) => riskBand(c.risk) === "low").length,
            },
          },
        );
        await logCostAsync({
          feature: "shopfront_clone_urlscan",
          provider: "urlscan",
          operation: "recheck_submit",
          units: submitted,
          unitCostUsd: 0, // free tier
          metadata: {
            submitted,
            submit_failed: submitFailed,
            dns_skipped: dnsSkipped,
            dns_servfail: dnsServfail,
            rate_limited: rateLimited,
            reputation_hits: reputationHits,
          },
        });
      });

      logger.info("clone-watch lifecycle re-check: complete", {
        rechecked: attemptedIds.length,
        pool: pool.length,
        submitted,
        submitFailed,
      });

      return {
        ok: true,
        rechecked: attemptedIds.length,
        pool: pool.length,
        submitted,
        submitFailed,
      };
    },
  ),
);
