import { inngest } from "@askarthur/scam-engine/inngest/client";
import {
  CLONE_WATCH_WEAPONISED_EVENT,
  type CloneWatchWeaponisedData,
} from "@askarthur/scam-engine/inngest/events";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";
import { retrieveURLScanDetailed } from "@askarthur/scam-engine/urlscan";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { logCostAsync } from "@/lib/cost-telemetry";
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
// Consecutive OUR-fault retrieval misses (5xx / timeout / parse) before one is
// allowed to cost a failure-streak point. Bounds the skip: 3 misses x 3 streak
// = 9 ticks (~27h) to evict, versus one unlucky window before v272 and never
// after it. See migration-v274.
const MAX_TRANSIENT_MISSES = 3;
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
    // 10m, not 5m. The batch step's own wall-clock guard (200s) bounds the
    // real work; the finish budget must ALSO cover ~4 step boundaries × up to
    // 60s of account-concurrency queue wait (#1069 — this fn was cancelled at
    // exactly 300s on 2026-08-31 and 2026-09-02, chopping the post-batch
    // steps). Finite per ADR-0019; guarded by inngestFinishBudgets.test.ts.
    timeouts: { finish: "10m" },
  },
  [
    // :10, not :00 (#1069): the top of the hour is the fleet's worst
    // concurrency pileup (hourly + */3 + */4 + */6 + */12 crons all fire).
    // Same 3h cadence; netcraft-auto's derived cron-ordering test still holds
    // (first verdict pass after the 09:00 submit is now 12:10 < 13:00).
    { cron: "10 */3 * * *" },
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
      // Rows we did not read because the miss was OUR fault (quota/transient),
      // not evidence about the URL. Counted, not silent.
      let skippedNotOurSignal = 0;
      let quotaExhausted = false;

      for (const [idx, row] of pending.entries()) {
        if (Date.now() - batchStartMs > BATCH_WALL_CLOCK_MS) break;
        try {
          const reputation = reputationFromEvidence(row.urlscan_evidence);
          const retrieval = await retrieveURLScanDetailed(row.urlscan_uuid);
          const nowIso = new Date().toISOString();

          // A 429 is OUR quota running out and a 5xx/timeout is urlscan being
          // unhealthy — neither is evidence about this URL. Persisting a null
          // classification here would bump urlscan_failure_streak, and three
          // strikes drop the row out of BOTH worklists permanently. This lane
          // runs 8x/day, so a single rate-limited window could strand a whole
          // batch.
          //
          // A 429 is global to the API key, so the rest of the batch would 429
          // too — stop, don't burn the remaining rows on calls we know will fail.
          if (retrieval.kind === "quota_exhausted") {
            skippedNotOurSignal += pending.length - idx;
            quotaExhausted = true;
            break;
          }

          // A transient miss leaves the verdict alone but MUST still be stamped.
          // The worklist is ORDER BY urlscan_submitted_at ASC LIMIT 40 and is
          // saturated on ~45% of runs, so a uuid that deterministically returns
          // `transient` would keep its oldest submitted_at and re-present at the
          // head forever, starving everything behind it — an unbounded skip is
          // the worklist-gate-starvation trap, not a fix for it. v274 counts the
          // miss in evidence without touching urlscan_scanned_at or the streak,
          // and only escalates to the streak after MAX_TRANSIENT_MISSES.
          if (retrieval.kind === "transient") {
            skippedNotOurSignal++;
            const miss = await sb.rpc(
              "record_clone_alert_urlscan_transient_miss",
              {
                p_alert_id: row.id,
                p_detail: retrieval.detail.slice(0, 200),
                p_max_misses: MAX_TRANSIENT_MISSES,
              },
            );
            if (miss.error) {
              throw new Error(
                `record_clone_alert_urlscan_transient_miss failed for alert ${row.id}: ${miss.error.message}`,
              );
            }
            continue;
          }

          const result = retrieval.kind === "ready" ? retrieval.result : null;

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

      return {
        classified,
        stillPending,
        reputationFallback,
        skippedNotOurSignal,
        quotaExhausted,
      };
    });

    const {
      classified,
      stillPending,
      reputationFallback,
      skippedNotOurSignal,
      quotaExhausted,
    } = batch;

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
      // Awaited (#1069): a finish-cancelled run kills waitUntil promises, so
      // fire-and-forget rows were being lost. Awaiting makes the row part of
      // the step's work.
      await logCostAsync({
        feature: "shopfront_clone_urlscan",
        provider: "urlscan",
        operation: "retrieve_batch",
        units: pending.length,
        unitCostUsd: 0,
        metadata: {
          classified,
          still_pending: stillPending,
          reputation_fallback: reputationFallback,
          skipped_not_our_signal: skippedNotOurSignal,
          quota_exhausted: quotaExhausted,
        },
      });
    });

    logger.info("clone-watch urlscan retrieve: batch complete", {
      pending: pending.length,
      classified,
      stillPending,
      reputationFallback,
      skippedNotOurSignal,
      quotaExhausted,
    });

    // Rows we could not read because of OUR quota or urlscan's health, not the
    // URL. Silent before this change — and each one used to cost a
    // failure-streak strike toward permanent exclusion.
    //
    // NOTE ON DESTINATION: `logger` (packages/utils/src/logger.ts) is
    // console-only — console.log/warn/error, no Axiom transport at ANY level.
    // The 10%-INFO-sampling rule belongs to the separate axiom-logger.ts, which
    // this file reaches only through the withAxiomLogging wrapper around the
    // whole function. So this warn buys stderr visibility and nothing more;
    // the durable signal is the cost_telemetry metadata written above, which is
    // what the verification queries read. Do not describe it as "always-ship".
    if (skippedNotOurSignal > 0) {
      logger.warn("clone-watch urlscan retrieve: skipped on quota/transient", {
        skipped: skippedNotOurSignal,
        pending: pending.length,
        quotaExhausted,
      });
    }

    return {
      ok: true,
      classified,
      stillPending,
      reputationFallback,
      skippedNotOurSignal,
      quotaExhausted,
    };
  }),
);
