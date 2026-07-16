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
 */

const SUBMIT_BATCH_LIMIT = 30;
const MIN_CONFIDENCE = 0.7;
const MAX_FAILURE_STREAK = 3;
// Break the batch loop before the finish budget so worst-case submit latency
// can't force a full-batch re-POST to urlscan; leftovers drain next tick.
const SUBMIT_WALL_CLOCK_MS = 200_000;

export const cloneWatchUrlscanSubmit = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan-submit",
    name: "Clone-Watch: urlscan submit (gated)",
    retries: 1,
    concurrency: { limit: 3 },
    // Global ceiling across all submits/day regardless of pool size — keeps a
    // matcher blow-up structurally incapable of recreating the May-27 burst.
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

    if (candidates.length === 0) {
      return { ok: true, submitted: 0, reason: "no_gated_candidates" };
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
      return { submitted, submitFailed, reputationHits };
    });
    const { submitted, submitFailed, reputationHits } = batch;

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_urlscan",
        provider: "urlscan",
        operation: "submit_batch",
        units: candidates.length,
        unitCostUsd: 0, // free tier (urlscan + SB/VT)
        metadata: { submitted, submit_failed: submitFailed, reputation_hits: reputationHits },
      });
    });

    logger.info("clone-watch urlscan submit: batch complete", {
      candidates: candidates.length,
      submitted,
      submitFailed,
      reputationHits,
    });

    return { ok: true, submitted, submitFailed, reputationHits };
  }),
);
