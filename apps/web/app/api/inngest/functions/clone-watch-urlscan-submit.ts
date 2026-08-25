import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import {
  submitCloneCandidate,
  type CloneCandidate,
} from "@/lib/clone-watch/urlscan-submit-one";

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
 * Gating: only candidates the Haiku preclassifier judged a likely clone
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
 * or cost number — the recheck lane already runs ~200 urlscan submits/day on
 * the same key. The quota check the ops doc had flagged UNVERIFIED for months
 * was finally run on 2026-08-23: the real entitlement is unlisted 1,000/day
 * (public 5,000, retrieve 10,000), not the documented 100. At 75 + recheck's
 * ~200 we sit at roughly a quarter of the ceiling. The binding constraint is
 * SUBMIT_WALL_CLOCK_MS below, not urlscan — and overshooting is graceful,
 * because a 429 leaves the row untouched (urlscan-submit-one.ts:112).
 */

const SUBMIT_BATCH_LIMIT = 75;
const MIN_CONFIDENCE = 0.7;
const MAX_FAILURE_STREAK = 3;
// Rows that age past the worklist's 90-day horizon while still unscanned are
// stamped `dormant` rather than silently vanishing (v285). Bounded per run.
const DORMANT_HORIZON_DAYS = 90;
const DORMANT_BATCH_LIMIT = 500;
// Break the batch loop before the finish budget so worst-case submit latency
// can't force a full-batch re-POST to urlscan; leftovers drain next tick.
const SUBMIT_WALL_CLOCK_MS = 200_000;

export const cloneWatchUrlscanSubmit = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan-submit",
    name: "Clone-Watch: urlscan submit (gated)",
    retries: 1,
    concurrency: { limit: 3 },
    // Caps RUNS per day (queueing excess fires rather than dropping them —
    // docs/inngest-brakes.md §glossary). It is NOT a submissions ceiling: one
    // run submits up to SUBMIT_BATCH_LIMIT rows, so the true worst case is
    // limit x SUBMIT_BATCH_LIMIT. The comment here used to claim it was a
    // "global ceiling across all submits/day", and v285 briefly raised it to 90
    // on that misreading — which would have widened the manual-trigger blast
    // radius to 90x75 against a 1,000/day urlscan quota. Reverted: the cron
    // fires once, so the real daily figure is SUBMIT_BATCH_LIMIT, and 40 runs
    // is ample headroom for operator re-fires.
    throttle: { limit: 40, period: "1d" },
    timeouts: { finish: "5m" },
  },
  [
    { cron: "0 9 * * *" },
    { event: "shopfront/clone.urlscan-submit.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "shopfront-clone-urlscan-submit" }, async ({ step }) => {
    if (!featureFlags.shopfrontCloneUrlscan) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
    }
    if (!process.env.URLSCAN_API_KEY) {
      return { skipped: true, reason: "URLSCAN_API_KEY not set" };
    }
    const sb = createServiceClient();
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    const candidates = await step.run("load-gated-candidates", async () => {
      const { data } = await sb.rpc("list_clone_alerts_pending_urlscan_submit", {
        p_limit: SUBMIT_BATCH_LIMIT,
        p_min_confidence: MIN_CONFIDENCE,
        p_max_failure_streak: MAX_FAILURE_STREAK,
      });
      return (data as CloneCandidate[] | null) ?? [];
    });

    // Retire what we are giving up on, BEFORE the empty-worklist return — a
    // quiet day is exactly when the horizon still needs sweeping. Widening the
    // worklist horizon to 90 days without this would only move the silent drop
    // from day 14 to day 90; stamping `dormant` makes the abandonment countable
    // (and gives that state its first writer since v199 declared it).
    const dormant = await step.run("retire-aged-out", async () => {
      const { data, error } = await sb.rpc("mark_stale_clone_alerts_dormant", {
        p_horizon_days: DORMANT_HORIZON_DAYS,
        p_min_confidence: MIN_CONFIDENCE,
        p_limit: DORMANT_BATCH_LIMIT,
      });
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

    if (candidates.length === 0) {
      // Still log the sweep — cost_telemetry is the durable record (this
      // logger is console-backed with no Axiom transport), so a run that only
      // retired rows must not be invisible.
      if (dormant > 0) {
        await step.run("log-cost-dormant-only", async () => {
          logCost({
            feature: "shopfront_clone_urlscan",
            provider: "urlscan",
            operation: "submit_batch",
            units: 0,
            unitCostUsd: 0,
            metadata: { submitted: 0, dormant_retired: dormant },
          });
        });
      }
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
    // doesn't abort the rest; a failed row is retried next tick. A wall-clock
    // guard breaks before the finish budget so worst-case submit latency can't
    // force a full-batch replay (which would re-POST to urlscan) — leftovers
    // drain next tick (submit is urlscan_submitted_at-idempotent).
    const submitStartMs = Date.now();
    const batch = await step.run("submit-batch", async () => {
      let submitted = 0;
      let submitFailed = 0;
      let rateLimited = 0;
      let reputationHits = 0;
      for (const row of candidates) {
        if (Date.now() - submitStartMs > SUBMIT_WALL_CLOCK_MS) break;
        try {
          const outcome = await submitCloneCandidate(row);
          if (outcome.reputationMalicious) reputationHits++;
          if (
            outcome.kind === "submitted" ||
            outcome.kind === "reputation_classified"
          ) {
            submitted++;
          } else if (outcome.kind === "rate_limited") {
            // Counted apart from failures: a 429 is quota exhaustion, leaves the
            // row untouched, and must not read as evidence about the URL. Before
            // this it was folded into submitFailed and left no DB trace, so
            // "has urlscan ever rate-limited us?" had no answer anywhere.
            rateLimited++;
          } else {
            submitFailed++;
          }
        } catch (err) {
          submitFailed++;
          logger.error("clone-watch urlscan submit: row failed", {
            alertId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { submitted, submitFailed, rateLimited, reputationHits };
    });
    const { submitted, submitFailed, rateLimited, reputationHits } = batch;

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_urlscan",
        provider: "urlscan",
        operation: "submit_batch",
        units: candidates.length,
        unitCostUsd: 0, // free tier (urlscan + SB/VT)
        metadata: {
          submitted,
          submit_failed: submitFailed,
          rate_limited: rateLimited,
          reputation_hits: reputationHits,
          dormant_retired: dormant,
        },
      });
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
  }),
);
