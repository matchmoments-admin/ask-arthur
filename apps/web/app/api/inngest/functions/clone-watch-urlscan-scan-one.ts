import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_SCAN_REQUESTED_EVENT,
  parseCloneWatchScanRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCostAsync } from "@/lib/cost-telemetry";
import { submitCloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";

/**
 * Clone-Watch urlscan — single-candidate SUBMIT (operator override).
 *
 * Triggered by `shopfront/clone.scan-requested.v1`, which the admin "scan this
 * alert" endpoint (/api/admin/clone-watch/scan) emits. OPERATOR-ONLY: since
 * v224 the lifecycle-recheck loop submits its rescans INLINE (not via this
 * event), so this path is now low-volume single-click scans. It has no Inngest
 * throttle: its spend is bounded where the event is emitted, by the admin
 * route's urlscan budget check (lib/clone-watch/urlscan-budget.ts, spender
 * `scanOne`: 20/hour, 100/day in units, plus key-wide unlisted headroom).
 * Its log-cost row is what that check counts. Unlike the gated batch cron,
 * this deliberately bypasses the
 * preclassifier gate — the operator chose this specific alert, so we honour
 * it. It only SUBMITS (reputation + urlscan
 * UUID); `clone-watch-urlscan-retrieve` picks up the result on its next tick.
 *
 * idempotency on event.id: the admin route stamps a unique id per click, so
 * repeated manual scans of the same alert each run, but an Inngest retry of a
 * single click does not double-submit.
 */
export const cloneWatchUrlscanScanOne = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan-scan-one",
    name: "Clone-Watch: urlscan submit (single, operator)",
    retries: 1,
    concurrency: { limit: 3 },
    idempotency: "event.id",
    // Raised (#1069): step boundaries queue for the account's 5 Hobby-plan
    // concurrency slots (~30–60s each under contention); the old budget
    // cancelled healthy runs. Finite per ADR-0019; floor guarded by
    // inngestFinishBudgets.test.ts.
    timeouts: { finish: "5m" },
  },
  { event: CLONE_WATCH_SCAN_REQUESTED_EVENT },
  withAxiomLogging({ fnId: "shopfront-clone-urlscan-scan-one" }, async ({ event, step }) => {
    const data = parseCloneWatchScanRequestedData(event.data);

    if (!featureFlags.shopfrontCloneUrlscan) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
    }
    if (!process.env.URLSCAN_API_KEY) {
      return { skipped: true, reason: "URLSCAN_API_KEY not set" };
    }

    const outcome = await step.run("submit-one", () =>
      submitCloneCandidate({
        id: data.alertId,
        candidate_url: data.candidateUrl,
        candidate_domain: data.candidateDomain,
      }),
    );

    // This row is the scan's entry in the unlisted-urlscan ledger. The admin
    // route's budget check (urlscan-budget.ts) sums its units per hour/day.
    // Before this path wrote it, operator scans were invisible in the spend
    // record, and the route's cap could not fire however hard the button was
    // clicked.
    await step.run("log-cost", async () => {
      await logCostAsync({
        feature: "shopfront_clone_urlscan",
        provider: "urlscan",
        operation: "scan_one",
        units: 1,
        unitCostUsd: 0, // free tier — units are the budget, not dollars
        metadata: {
          alert_id: data.alertId,
          outcome: outcome.kind,
          reputation_malicious: outcome.reputationMalicious,
        },
      });
    });

    logger.info("clone-watch urlscan scan-one: complete", {
      alertId: data.alertId,
      outcome: outcome.kind,
      reputationMalicious: outcome.reputationMalicious,
    });

    return { ok: true, alertId: data.alertId, outcome: outcome.kind };
  }),
);
