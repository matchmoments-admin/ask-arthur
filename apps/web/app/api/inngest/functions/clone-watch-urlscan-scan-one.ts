import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import {
  CLONE_WATCH_SCAN_REQUESTED_EVENT,
  parseCloneWatchScanRequestedData,
} from "@askarthur/scam-engine/inngest/events";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
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

    logger.info("clone-watch urlscan scan-one: complete", {
      alertId: data.alertId,
      outcome: outcome.kind,
      reputationMalicious: outcome.reputationMalicious,
    });

    return { ok: true, alertId: data.alertId, outcome: outcome.kind };
  }),
);
