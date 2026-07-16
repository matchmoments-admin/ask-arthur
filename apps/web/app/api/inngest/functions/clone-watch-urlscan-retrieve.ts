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
// Break the batch loop before the 5m Inngest finish budget so worst-case
// external latency can't force a full-batch replay (leftovers drain next tick).
const BATCH_WALL_CLOCK_MS = 200_000;
// Bounded weaponised-emit worklist per run (durable, self-draining).
const WEAPONISED_EMIT_CAP = 100;

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

    // Drive the v199 enforcement lifecycle from the urlscan verdict via the
    // edge-guarded v200 RPC (never downgrades reported/terminal states). The RPC
    // stamps weaponised_at on the real transition; the weaponised.v1 emission is
    // now driven from that persisted state (weaponised_at NOT NULL AND
    // weaponised_notified_at NULL, v236) rather than an in-memory array — so a
    // batch step interrupted after a transition but before emit doesn't silently
    // drop the event (the drop the array approach caused; #762 regression).
    const applyVerdict = async (
      row: RetrieveRow,
      classification: string,
    ): Promise<void> => {
      const { error } = await sb.rpc("apply_clone_urlscan_verdict", {
        p_alert_id: row.id,
        p_classification: classification,
      });
      if (error) {
        throw new Error(
          `apply_clone_urlscan_verdict failed for alert ${row.id}: ${error.message}`,
        );
      }
    };

    // Retrieve + classify the whole batch inside ONE step instead of one step
    // per row. Inngest bills per step execution, so a 40-row batch was ~40
    // executions × 8 runs/day for this fn alone; collapsing to a single step
    // cuts that ~20×. Safe because every write is an idempotent, edge-guarded
    // RPC — a batch-step retry re-runs already-processed rows without double-
    // advancing lifecycle or re-emitting weaponised events (apply_verdict only
    // reports newly_weaponised on the real transition; retrieve is a GET). Each
    // row is wrapped in try/catch so one failure doesn't abort the rest; a
    // failed row is left un-advanced (stays in the worklist) and retried next
    // tick. Weaponisation is emitted from persisted state (durable emit step
    // below), not an array, so an interrupted batch can't drop the event.
    // A wall-clock guard breaks the loop before the 5m finish budget so
    // worst-case external latency (40 rows × urlscan GET) can't force a
    // full-batch replay — leftovers drain next tick (worklist is idempotent).
    const batchStartMs = Date.now();
    const batch = await step.run("retrieve-batch", async () => {
      let classified = 0;
      let stillPending = 0;
      let reputationFallback = 0;

      for (const row of pending) {
        if (Date.now() - batchStartMs > BATCH_WALL_CLOCK_MS) break;
        try {
          const reputation = reputationFromEvidence(row.urlscan_evidence);
          const result = await retrieveURLScan(row.urlscan_uuid);
          const nowIso = new Date().toISOString();

          // Render ready → full classification (reputation merged in).
          if (result) {
            const classification = classifyScan(result, reputation.isMalicious);
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
            await applyVerdict(row, classification);
            classified++;
            continue;
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
            await applyVerdict(row, "likely_phishing");
            classified++;
            reputationFallback++;
            continue;
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
          stillPending++;
        } catch (err) {
          logger.error("clone-watch urlscan retrieve: row failed", {
            alertId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { classified, stillPending, reputationFallback };
    });

    const { classified, stillPending, reputationFallback } = batch;

    // Durable weaponised.v1 emission (the escalation seam — notify-weaponised +
    // enforcement-plan consume it). Driven from PERSISTED state, not the batch's
    // in-memory result: any alert that is weaponised but not yet notified —
    // including this run's transitions AND any a prior interrupted run missed —
    // is picked up here. send + stamp happen in one step: on retry the re-query
    // returns the still-unstamped rows, the send dedupes on the id key, and the
    // stamp is the completion marker → idempotent, no double-send, no drop.
    await step.run("emit-weaponised", async () => {
      const { data, error } = await sb
        .from("shopfront_clone_alerts")
        .select("id, candidate_domain, candidate_url, recheck_count")
        .not("weaponised_at", "is", null)
        .is("weaponised_notified_at", null)
        .limit(WEAPONISED_EMIT_CAP);
      if (error) {
        throw new Error(`weaponised emit select failed: ${error.message}`);
      }
      const rows = (data ?? []) as Array<{
        id: number;
        candidate_domain: string;
        candidate_url: string;
        recheck_count: number | null;
      }>;
      if (rows.length === 0) return { emitted: 0 };

      const events = rows.map((r) => {
        // via: a clone weaponised on its first scan has recheck_count 0;
        // one caught on a re-scan has recheck_count > 0.
        const via = (r.recheck_count ?? 0) > 0 ? "recheck" : "initial";
        const d: CloneWatchWeaponisedData = {
          alertId: r.id,
          candidateDomain: r.candidate_domain,
          candidateUrl: r.candidate_url,
          via,
        };
        // Rare high-value event: always-ship warn (bypasses INFO sampling).
        logger.warn("clone-watch: classification transition — newly weaponised", {
          alertId: d.alertId,
          candidateDomain: d.candidateDomain,
          candidateUrl: d.candidateUrl,
          via: d.via,
          classification: "likely_phishing",
        });
        return {
          name: CLONE_WATCH_WEAPONISED_EVENT,
          id: `clone-weaponised-${d.alertId}-${d.via}`,
          data: d,
        };
      });
      await inngest.send(events);
      // Completion marker — set AFTER the send so a mid-step interrupt re-emits
      // (deduped) rather than dropping.
      const { error: stampError } = await sb
        .from("shopfront_clone_alerts")
        .update({ weaponised_notified_at: new Date().toISOString() })
        .in(
          "id",
          rows.map((r) => r.id),
        );
      if (stampError) {
        throw new Error(`weaponised notified stamp failed: ${stampError.message}`);
      }
      return { emitted: rows.length };
    });

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
