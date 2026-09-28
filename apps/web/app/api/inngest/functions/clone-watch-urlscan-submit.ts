import { inngest } from "@askarthur/scam-engine/inngest/client";
import { recordLaneOutcome } from "@askarthur/scam-engine/lane-outcome";
import { budgetedStep } from "@askarthur/scam-engine/inngest/step-budget";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import {
  submitCandidateBatch,
  type CloneCandidate,
} from "@/lib/clone-watch/urlscan-submit-one";
import {
  composeSubmitBatch,
  loadAuditSamples,
  markAuditMissesWarned,
  stampAuditAttempts,
  surfaceAuditMisses,
} from "@/lib/clone-watch/not-a-clone-audit";
import { WORKLIST_MIN_CONFIDENCE } from "@/lib/clone-watch/preclassify-thresholds";
import { laneCrons, laneGate } from "@/lib/laneHealth";
import {
  URLSCAN_SPENDERS,
  checkUnlistedHeadroom,
} from "@/lib/clone-watch/urlscan-budget";

/**
 * Clone-Watch urlscan — Stage 1 of 2: SUBMIT.
 *
 * Replaces the old per-candidate submit→sleep→retrieve monolith
 * (clone-watch-urlscan.ts). That polled urlscan ~90s after submit inside the
 * same durable run, and timed out 100% of the time because the free tier
 * queues fresh-NRD scans far longer. Here we only SUBMIT (reputation +
 * fire-and-store the UUID); `clone-watch-urlscan-retrieve` fetches the result
 * hours later when it's actually ready.
 *
 * Gating: only candidates the pre-classifier (Jev since ADR-0026; Haiku
 * before) judged a likely clone
 * (is_clone AND confidence >= threshold) — see list_clone_alerts_pending_
 * urlscan_submit. Most low-severity lexical matches are skipped.
 *
 * Cron 09:00 UTC — after the 08:30 NRD ingest + the preclassify fan-out it
 * triggers have settled, so the gate has classification rows to read.
 *
 * COVERAGE (v285, measured 2026-08-23). 924 of 2,786 alerts had never received
 * a urlscan verdict, 422 of them high-confidence. Two causes, both fixed in the
 * v285 worklist: a 400 ("DNS Error - Could not resolve domain") was counting
 * toward the death streak, retiring 281 high-confidence rows — a random sample
 * of 70 showed 43% resolving months later, i.e. we were discarding exactly the
 * pre-weaponisation tail this feature exists to watch; and the worklist was
 * LIFO with a 14-day cutoff, so backlog rows were outranked until they aged out
 * permanently. That matters more since v284 made Netcraft submission require a
 * urlscan verdict: no verdict now means no report, ever.
 *
 * The batch limit was raised 30 -> 75 at the same time. 30 was never a vendor
 * or cost number. The quota check the ops doc had flagged UNVERIFIED for months
 * was finally run on 2026-08-23: the real entitlement is unlisted 1,000/day
 * (public 5,000, retrieve 10,000), not the documented 100. How this lane's 75
 * sits beside the other unlisted spenders (recheck 90 × 4 = 360/day,
 * enrichment 20 × 3, admin scans) is NOT restated here: the numbers, the
 * cron placement and the per-hour/per-day proof live in
 * lib/clone-watch/urlscan-budget.ts and __tests__/urlscanBudget.test.ts.
 * Overshooting is graceful: a 429 leaves the row untouched (`rate_limited` in
 * urlscan-submit-one.ts).
 *
 * NOT-A-CLONE AUDIT (#1238, v330). The lane also carries a random sample of
 * is_clone=false alerts — never scanned otherwise — so the pre-classifier's
 * false-negative rate is measured (lib/clone-watch/not-a-clone-audit.ts). The
 * audit is MEASUREMENT: v330 routes a sampled miss to monitoring, never
 * weaponised, and this lane surfaces each miss durably (Axiom warn + ids on the
 * Outcome Row) for human review. Samples
 * take at most AUDIT_SLOTS_PER_RUN (= SUBMIT_AUDIT_SHARE in urlscan-budget.ts)
 * of the SUBMIT_BATCH_LIMIT slots and run after the regular batch. Only ~33
 * regular rows were eligible on 2026-09-26, so they mostly fill otherwise-empty
 * slots: while samples are due the lane makes up to 25 MORE urlscan submits a
 * day (plus their retrieves), never more than SUBMIT_BATCH_LIMIT in the run.
 * The hour and minute fit is proven in urlscanBudget.test.ts, not argued here;
 * submits are paced (URLSCAN_SPENDERS.submit.minStartIntervalMs). The weekly
 * draw runs inside the load step (once per UTC ISO week), gated
 * FF_CLONE_WATCH_NOT_A_CLONE_AUDIT_WEEKLY; the one-off baseline is drawn by an
 * operator (docs/ops/clone-watch-config.md). Every tried sample gets an attempt
 * (168 h re-offer, max 3), so an unscannable one cannot re-present forever.
 */

// Declared once, in the urlscan budget roster (includes the audit share).
const SUBMIT_BATCH_LIMIT = URLSCAN_SPENDERS.submit.perRun;
const SUBMIT_MIN_START_INTERVAL_MS = URLSCAN_SPENDERS.submit.minStartIntervalMs;
const MANUAL_EVENT = "shopfront/clone.urlscan-submit.manual-trigger.v1";
// ADR-0026: `confidence` is Jev's calibrated P(clone); the threshold lives
// with its evidence in lib/clone-watch/preclassify-thresholds.ts.
const MIN_CONFIDENCE = WORKLIST_MIN_CONFIDENCE;
const MAX_FAILURE_STREAK = 3;
// Rows that age past the worklist's 90-day horizon while still unscanned are
// stamped `dormant` rather than silently vanishing (v285). Bounded per run.
const DORMANT_HORIZON_DAYS = 90;
const DORMANT_BATCH_LIMIT = 500;
// Break the batch loop before the ROUTE's maxDuration (the loop runs inside
// ONE step, so that is the bound that kills it — step-budget.ts) so worst-case
// submit latency can't force a full-batch re-POST to urlscan; leftovers drain
// next tick. In-step: the clock starts at step entry, never at event.ts. From
// #1124 (Sep 8) to #1141 it was a spanning budget measured from the 09:00:00
// cron tick, and the fn reaches this step ~200s+ later on the :00 fleet
// pileup — so `expired()` was true at index 0 and the lane processed 0 of 75
// candidates every day from Sep 12, while logging it honestly and alerting
// nobody. Under budgetedStep's 240s ceiling.
const SUBMIT_WALL_CLOCK_MS = 200_000;

export const cloneWatchUrlscanSubmit = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan-submit",
    name: "Clone-Watch: urlscan submit (gated)",
    retries: 1,
    concurrency: { limit: 3 },
    // Caps RUNS per day (queueing excess fires rather than dropping them —
    // docs/inngest-brakes.md §glossary). It is NOT a submissions ceiling: one
    // run submits up to SUBMIT_BATCH_LIMIT rows. The comment here used to claim
    // it was a "global ceiling across all submits/day", and v285 briefly raised
    // it to 90 on that misreading. The cron fires once (75/day); a MANUAL fire
    // spends only what the unlisted budget admits (check-urlscan-budget below),
    // so 40 runs/day bounds Inngest invocations, not urlscan spend.
    throttle: { limit: 40, period: "1d" },
    // 10m, not 5m: the batch wall-clock guard (200s) bounds real work; the
    // finish budget must also cover ~4 step boundaries × up to 60s of
    // account-concurrency queue wait (#1069 — the 2026-08-31 run was
    // cancelled mid-flight and its leftovers waited a full day because this
    // cron fires once daily). Finite per ADR-0019; guarded by
    // inngestFinishBudgets.test.ts.
    timeouts: { finish: "10m" },
  },
  [
    ...laneCrons("shopfront-clone-urlscan-submit"),
    { event: MANUAL_EVENT },
  ],
  withAxiomLogging(
    { fnId: "shopfront-clone-urlscan-submit" },
    async ({ event, step, runId }) => {
      // Flag gate declared once, in LANE_SHAPES (the digest reads the same list).
      const gate = laneGate("shopfront-clone-urlscan-submit");
      if (!gate.ok) return { skipped: true, reason: gate.reason };
      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }
      const sb = createServiceClient();
      if (!sb) return { skipped: true, reason: "supabase_unavailable" };

      // A MANUAL fire must fit urlscan's key-wide unlisted budget: all unlisted
      // spend in the trailing hour/day (every lane, in units) plus any
      // scheduled batch in flight or due within the hour. Unreadable ledger →
      // refused (fail closed). The 09:00 cron is proven to fit statically
      // (urlscanBudget.test.ts), so it does not pay this read. Inside a step:
      // a replay reuses the decision instead of re-reading a ledger that now
      // contains this run's own row.
      if (event?.name === MANUAL_EVENT) {
        const budget = await step.run("check-urlscan-budget", () =>
          checkUnlistedHeadroom(sb, "submit"),
        );
        if (!budget.ok) {
          logger.warn("clone-watch urlscan submit: manual fire refused by urlscan budget", {
            ...budget,
          });
          return { skipped: true, reason: `urlscan_budget_${budget.reason}`, budget };
        }
      }

      const loaded = await step.run("load-gated-candidates", async () => {
        // Not-a-clone audit (#1238): draw (weekly, flagged), claim new misses,
        // list due samples. Never fails the run (see loadAuditSamples).
        const audit = await loadAuditSamples(sb, {
          drawWeekly: featureFlags.cloneWatchNotACloneAuditWeekly,
        });
        if (audit.error) {
          logger.error("clone-watch urlscan submit: audit sample load failed", {
            error: audit.error,
          });
        }
        // The regular worklist is always asked for the FULL batch so v285's
        // oldest-rows reserve (a third of p_limit) keeps its size;
        // composeSubmitBatch trims the freshest tail to make room.
        const { data } = await sb.rpc(
          "list_clone_alerts_pending_urlscan_submit",
          {
            p_limit: SUBMIT_BATCH_LIMIT,
            p_min_confidence: MIN_CONFIDENCE,
            p_max_failure_streak: MAX_FAILURE_STREAK,
          },
        );
        const fetched = (data as CloneCandidate[] | null) ?? [];
        const plan = composeSubmitBatch(fetched, audit.samples, SUBMIT_BATCH_LIMIT);
        return {
          ...plan,
          regularFetched: fetched.length,
          auditDrawn: audit.drawn,
          auditMisses: audit.misses,
        };
      });
      const { regular: candidates, audit: auditCandidates, auditDrawn } = loaded;

      // Audit misses (v330): a sampled "not a clone" that urlscan graded
      // likely_phishing. It was routed to monitoring, NOT weaponised — no brand,
      // feed or vendor action happens — so a human must look at it. Surfaced
      // durably: one always-ship Axiom warn each, inside a step (a replay does
      // not repeat it; a failed flush throws and retries), then the ids go on
      // the Outcome Row and only after that are they stamped miss_warned_at.
      const auditMissIds = loaded.auditMisses.map((m) => m.alert_id);
      // Called inside the log-cost step, AFTER the Outcome Row write.
      const stampMissesSurfaced = async (ids: number[]) => {
        if ((await markAuditMissesWarned(sb, ids)) === null) {
          logger.error("clone-watch urlscan submit: audit miss stamp failed", {
            ids: ids.length,
          });
        }
      };
      if (auditMissIds.length > 0) {
        await step.run("surface-audit-misses", () =>
          surfaceAuditMisses(loaded.auditMisses, runId),
        );
      }

      // Retire what we are giving up on, BEFORE the empty-worklist return — a
      // quiet day is exactly when the horizon still needs sweeping. Widening the
      // worklist horizon to 90 days without this would only move the silent drop
      // from day 14 to day 90; stamping `dormant` makes the abandonment countable
      // (and gives that state its first writer since v199 declared it).
      const dormant = await step.run("retire-aged-out", async () => {
        const { data, error } = await sb.rpc(
          "mark_stale_clone_alerts_dormant",
          {
            p_horizon_days: DORMANT_HORIZON_DAYS,
            p_min_confidence: MIN_CONFIDENCE,
            p_limit: DORMANT_BATCH_LIMIT,
          },
        );
        if (error) {
          // Never fail the submit run over bookkeeping.
          logger.error("clone-watch urlscan submit: dormant sweep failed", {
            error: error.message,
          });
          return 0;
        }
        return typeof data === "number" ? data : 0;
      });

      if (dormant > 0) {
        logger.warn("clone-watch urlscan submit: alerts retired as dormant", {
          dormant,
          horizonDays: DORMANT_HORIZON_DAYS,
        });
      }

      if (candidates.length === 0 && auditCandidates.length === 0) {
        // Still log the sweep — cost_telemetry is the durable record (this
        // logger is console-backed with no Axiom transport), so a run that only
        // retired rows must not be invisible. Unconditional since #1145: the
        // digest's silent-zero detector judges this lane ABSENT when no
        // submit_batch row lands inside 26h, and a quiet day (no gated
        // candidates, nothing to retire) used to write nothing. units 0
        // satisfies no silent-zero predicate.
        await step.run("log-cost-quiet", async () => {
          await recordLaneOutcome("shopfront-clone-urlscan-submit", 0, {
            reason: "no_gated_candidates",
            submitted: 0,
            submit_failed: 0,
            rate_limited: 0,
            dormant_retired: dormant,
            audit_drawn: auditDrawn,
            audit_misses: auditMissIds.length,
            audit_miss_ids: auditMissIds,
            audit_offered: 0,
            audit_attempted: 0,
          });
          await stampMissesSurfaced(auditMissIds);
        });
        return {
          ok: true,
          submitted: 0,
          dormant,
          reason: "no_gated_candidates",
        };
      }

      // Submit the whole batch inside ONE step instead of one step per candidate.
      // Inngest bills per step execution; a single batch step cuts a 30-candidate
      // run from ~30 executions to ~1. urlscan submit is idempotent (the helper
      // records urlscan_submitted_at and the retrieve worklist de-dupes on it),
      // so a batch-step retry re-submits harmlessly and losing per-row
      // memoisation is safe. Each row is wrapped in try/catch so one failure
      // doesn't abort the rest; a failed row is retried next tick. The in-step
      // budget breaks the loop before Vercel's maxDuration kill so worst-case
      // submit latency can't force a full-batch replay (which would re-POST to
      // urlscan) — leftovers drain next tick (submit is
      // urlscan_submitted_at-idempotent). The loop does NOT await step.run per
      // item, so this is an in-step budget, not a spanning one.
      const batch = await budgetedStep(
        step,
        "submit-batch",
        SUBMIT_WALL_CLOCK_MS,
        async (budget) => {
          // The outcome → counter mapping lives in submitCandidateBatch (one
          // copy for this lane and the recheck lane). A 429 is counted apart
          // from failures: quota exhaustion, row untouched, no evidence about
          // the URL.
          const onRowError = (alertId: number, err: unknown) =>
            logger.error("clone-watch urlscan submit: row failed", {
              alertId,
              error: err instanceof Error ? err.message : String(err),
            });
          const tally = await submitCandidateBatch(candidates, budget, {
            onRowError,
            minStartIntervalMs: SUBMIT_MIN_START_INTERVAL_MS,
          });
          // Audit samples run AFTER the regular batch, on the same budget, as a
          // SEPARATE tally: the Outcome Row's units / submitted / dns_* — and so
          // the lane's silent-zero shape — describe regular work only, and a
          // day of DNS-dead samples cannot read as a broken lane.
          const auditTally = await submitCandidateBatch(auditCandidates, budget, {
            onRowError,
            minStartIntervalMs: SUBMIT_MIN_START_INTERVAL_MS,
          });
          // One attempt per tried sample, in the same step so a replay cannot
          // separate the submit from its stamp. A 429 or an unreached sample is
          // not in attemptedIds and stays due.
          const stamped = await stampAuditAttempts(sb, auditTally.attemptedIds);
          if (stamped === null) {
            logger.error("clone-watch urlscan submit: audit stamp failed", {
              ids: auditTally.attemptedIds.length,
            });
          }
          return { ...tally, audit: auditTally };
        },
      );
      const {
        submitted,
        submitFailed,
        rateLimited,
        dnsSkipped,
        dnsServfail,
        reputationHits,
        unreached,
        audit: auditTally,
      } = batch;

      await step.run("log-cost", async () => {
        // Awaited (#1069): the Aug 31 submit run was finish-cancelled after the
        // batch step and this row silently vanished — the day's submit telemetry
        // simply did not exist. Awaiting binds the row to the step.
        await recordLaneOutcome(
          "shopfront-clone-urlscan-submit",
          candidates.length,
          {
            submitted,
            submit_failed: submitFailed,
            dns_skipped: dnsSkipped,
            dns_servfail: dnsServfail,
            rate_limited: rateLimited,
            reputation_hits: reputationHits,
            dormant_retired: dormant,
            unreached,
            // #1231: gated rows were left for tomorrow — the worklist filled the
            // whole fetch, or audit samples took slots regular rows would have.
            cap: SUBMIT_BATCH_LIMIT,
            cap_reached:
              loaded.regularFetched >= SUBMIT_BATCH_LIMIT || loaded.regularLeft > 0,
            audit_drawn: auditDrawn,
            audit_misses: auditMissIds.length,
            audit_miss_ids: auditMissIds,
            audit_offered: auditCandidates.length,
            audit_attempted: auditTally.attemptedIds.length,
            audit_submitted: auditTally.submitted,
            audit_dns_skipped: auditTally.dnsSkipped + auditTally.dnsServfail,
            audit_submit_failed: auditTally.submitFailed,
            audit_rate_limited: auditTally.rateLimited,
          },
        );
        await stampMissesSurfaced(auditMissIds);
      });

      logger.info("clone-watch urlscan submit: batch complete", {
        candidates: candidates.length,
        submitted,
        submitFailed,
        rateLimited,
        reputationHits,
        dormant,
      });

      // The durable signal is the cost_telemetry row above; this is stderr only
      // (packages/utils/src/logger.ts is console-backed, no Axiom transport).
      if (rateLimited > 0) {
        logger.warn("clone-watch urlscan submit: rate-limited by urlscan", {
          rateLimited,
          candidates: candidates.length,
        });
      }

      return {
        ok: true,
        submitted,
        submitFailed,
        rateLimited,
        reputationHits,
        dormant,
      };
    },
  ),
);
