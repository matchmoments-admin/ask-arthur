import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_SCAN_REQUESTED_EVENT,
  parseCloneWatchScanRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import { submitCloneCandidate } from "@/lib/clone-watch/urlscan-submit-one";

/**
 * Clone-Watch urlscan — single-candidate SUBMIT (operator override).
 *
 * Triggered by `shopfront/clone.scan-requested.v1`, which the admin "scan this
 * alert" endpoint (/api/admin/clone-watch/scan) emits. OPERATOR-ONLY: since
 * v224 the lifecycle-recheck loop submits its rescans INLINE (not via this
 * event), so this path is now low-volume single-click scans and needs no
 * throttle. Unlike the gated batch cron, this deliberately bypasses the
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
    timeouts: { finish: "2m" },
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

    // This path submitted to urlscan and logged NOTHING to cost_telemetry, with
    // two consequences. First, operator scans were invisible in the spend/volume
    // record while every batch lane was accounted for. Second — and worse — the
    // admin route's "20 clone-watch scans per hour" soft cap counts
    // cost_telemetry rows under feature='shopfront_clone_urlscan', so it was
    // counting only the batch lanes' ~13 rows/day: no rolling hour could ever
    // reach 20, and the limit could not fire however hard the button was
    // clicked. Writing one row per operator scan is what makes it real.
    await step.run("log-cost", async () => {
      logCost({
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
