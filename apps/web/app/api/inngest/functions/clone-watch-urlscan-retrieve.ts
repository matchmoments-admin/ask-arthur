import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_WEAPONISED_EVENT,
  type CloneWatchWeaponisedData,
} from "@askarthur/scam-engine/inngest/events";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { retrieveURLScan } from "@askarthur/scam-engine/urlscan";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "@/lib/cost-telemetry";
import {
  classifyScan,
  suggestTriageTransition,
  serialiseRetrievedEvidence,
  serialiseRetrievalPending,
  reputationFromEvidence,
} from "@/lib/clone-watch/urlscan-classify";

/**
 * Clone-Watch urlscan — Stage 2 of 2: RETRIEVE.
 *
 * Batched cron (every 3h). Pulls urlscan results that were submitted by
 * `clone-watch-urlscan-submit` at least MIN_AGE_MINUTES ago — by which point
 * the free-tier render is actually finished, fixing the 0%-retrieval bug that
 * killed the old in-run 90s poll.
 *
 * One run handles every pending candidate (1 run for N results, vs the old N
 * runs each polling with sleeps + retries). Classification merges the urlscan
 * render with the SB/VT reputation verdict stored at submit time:
 *   - result ready → classifyScan(result, reputationMalicious) → persist
 *   - result null + reputation malicious → classify likely_phishing (decisive,
 *     stop waiting)
 *   - result null + clean → persist NULL → failure_streak++ (retry next tick;
 *     the retrieve-pending RPC drops it once the streak hits MAX_FAILURE_STREAK)
 */

const RETRIEVE_BATCH_LIMIT = 40;
const MIN_AGE_MINUTES = 10; // give urlscan time to finish before first poll
const MAX_FAILURE_STREAK = 3;

interface RetrieveRow {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  urlscan_uuid: string;
  urlscan_evidence: unknown;
}

export const cloneWatchUrlscanRetrieve = inngest.createFunction(
  {
    id: "shopfront-clone-urlscan-retrieve",
    name: "Clone-Watch: urlscan retrieve (batched)",
    retries: 1,
    concurrency: { limit: 3 },
    timeouts: { finish: "5m" },
  },
  [
    { cron: "0 */3 * * *" },
    { event: "shopfront/clone.urlscan-retrieve.manual-trigger.v1" },
  ],
  withAxiomLogging({ fnId: "shopfront-clone-urlscan-retrieve" }, async ({ step }) => {
    if (!featureFlags.shopfrontCloneUrlscan) {
      return { skipped: true, reason: "FF_SHOPFRONT_CLONE_URLSCAN disabled" };
    }
    if (!process.env.URLSCAN_API_KEY) {
      return { skipped: true, reason: "URLSCAN_API_KEY not set" };
    }
    const sb = createServiceClient();
    if (!sb) return { skipped: true, reason: "supabase_unavailable" };

    const pending = await step.run("load-pending-retrieve", async () => {
      const { data } = await sb.rpc("list_clone_alerts_pending_urlscan_retrieve", {
        p_limit: RETRIEVE_BATCH_LIMIT,
        p_min_age_minutes: MIN_AGE_MINUTES,
        p_max_failure_streak: MAX_FAILURE_STREAK,
      });
      return (data as RetrieveRow[] | null) ?? [];
    });

    if (pending.length === 0) {
      return { ok: true, retrieved: 0, reason: "nothing_pending" };
    }

    let classified = 0;
    let stillPending = 0;
    let reputationFallback = 0;
    const weaponisedEvents: CloneWatchWeaponisedData[] = [];

    // Drive the v199 enforcement lifecycle from the urlscan verdict via the
    // edge-guarded v200 RPC (never downgrades reported/terminal states).
    // Returns the weaponised.v1 payload iff the alert NEWLY weaponised, so the
    // caller can emit exactly one event per transition — the result is carried
    // in the step's RETURN value (not a closure side-effect) so it survives
    // Inngest step-memoisation on replay.
    const applyVerdict = async (
      row: RetrieveRow,
      classification: string,
    ): Promise<CloneWatchWeaponisedData | null> => {
      const { data, error } = await sb.rpc("apply_clone_urlscan_verdict", {
        p_alert_id: row.id,
        p_classification: classification,
      });
      if (error) {
        throw new Error(
          `apply_clone_urlscan_verdict failed for alert ${row.id}: ${error.message}`,
        );
      }
      const verdict = data as {
        newly_weaponised?: boolean;
        prior?: string;
      } | null;
      if (!verdict?.newly_weaponised) return null;
      return {
        alertId: row.id,
        candidateDomain: row.candidate_domain,
        candidateUrl: row.candidate_url,
        via: verdict.prior === "detected" ? "initial" : "recheck",
      };
    };

    for (const row of pending) {
      const outcome = await step.run(`retrieve-${row.id}`, async () => {
        const reputation = reputationFromEvidence(row.urlscan_evidence);
        const result = await retrieveURLScan(row.urlscan_uuid);
        const nowIso = new Date().toISOString();

        // Render ready → full classification (reputation merged in).
        if (result) {
          const classification = classifyScan(result, reputation.isMalicious);
          // Check the persist error like applyVerdict does: a swallowed persist
          // failure would let lifecycle advance on an un-persisted
          // classification (v230 folds the transition archive into this txn).
          const persisted = await sb.rpc("persist_clone_alert_urlscan", {
            p_alert_id: row.id,
            p_urlscan_uuid: row.urlscan_uuid,
            p_urlscan_evidence: serialiseRetrievedEvidence(
              row.urlscan_uuid,
              result,
              reputation,
              nowIso,
            ),
            p_classification: classification,
            p_set_triage_status: suggestTriageTransition(classification),
          });
          if (persisted.error) {
            throw new Error(
              `persist_clone_alert_urlscan failed for alert ${row.id}: ${persisted.error.message}`,
            );
          }
          const weaponised = await applyVerdict(row, classification);
          return { kind: "classified" as const, classification, weaponised };
        }

        // Render not ready. If reputation is decisive, classify now and stop
        // waiting; otherwise persist NULL (bumps failure_streak → ages out).
        if (reputation.isMalicious) {
          const persisted = await sb.rpc("persist_clone_alert_urlscan", {
            p_alert_id: row.id,
            p_urlscan_uuid: row.urlscan_uuid,
            p_urlscan_evidence: serialiseRetrievalPending(
              row.urlscan_uuid,
              reputation,
              nowIso,
            ),
            p_classification: "likely_phishing",
            p_set_triage_status: null, // operator confirms TP (ultrareview F5)
          });
          if (persisted.error) {
            throw new Error(
              `persist_clone_alert_urlscan failed for alert ${row.id}: ${persisted.error.message}`,
            );
          }
          const weaponised = await applyVerdict(row, "likely_phishing");
          return { kind: "reputation_fallback" as const, weaponised };
        }

        const persisted = await sb.rpc("persist_clone_alert_urlscan", {
          p_alert_id: row.id,
          p_urlscan_uuid: row.urlscan_uuid,
          p_urlscan_evidence: serialiseRetrievalPending(
            row.urlscan_uuid,
            reputation,
            nowIso,
          ),
          p_classification: null, // failure_streak++; retried next tick
          p_set_triage_status: null,
        });
        if (persisted.error) {
          throw new Error(
            `persist_clone_alert_urlscan failed for alert ${row.id}: ${persisted.error.message}`,
          );
        }
        return { kind: "still_pending" as const, weaponised: null };
      });

      if (outcome.kind === "classified") classified++;
      else if (outcome.kind === "reputation_fallback") {
        classified++;
        reputationFallback++;
      } else stillPending++;
      if (outcome.weaponised) weaponisedEvents.push(outcome.weaponised);
    }

    // Emit one weaponised.v1 per newly-weaponised alert (the escalation seam;
    // Wave 1 enforcement consumes it). Batched, id-keyed for idempotency.
    if (weaponisedEvents.length > 0) {
      await step.run("emit-weaponised", async () => {
        // Rare high-value event: always-ship warn (bypasses the 10% INFO
        // sampling) so every weaponisation transition is visible in Axiom.
        for (const d of weaponisedEvents) {
          logger.warn("clone-watch: classification transition — newly weaponised", {
            alertId: d.alertId,
            candidateDomain: d.candidateDomain,
            candidateUrl: d.candidateUrl,
            via: d.via,
            classification: "likely_phishing",
          });
        }
        await inngest.send(
          weaponisedEvents.map((d) => ({
            name: CLONE_WATCH_WEAPONISED_EVENT,
            id: `clone-weaponised-${d.alertId}-${d.via}`,
            data: d,
          })),
        );
      });
    }

    await step.run("log-cost", async () => {
      logCost({
        feature: "shopfront_clone_urlscan",
        provider: "urlscan",
        operation: "retrieve_batch",
        units: pending.length,
        unitCostUsd: 0,
        metadata: {
          classified,
          still_pending: stillPending,
          reputation_fallback: reputationFallback,
        },
      });
    });

    logger.info("clone-watch urlscan retrieve: batch complete", {
      pending: pending.length,
      classified,
      stillPending,
      reputationFallback,
    });

    return { ok: true, classified, stillPending, reputationFallback };
  }),
);
