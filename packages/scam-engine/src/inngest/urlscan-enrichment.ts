// URLScan.io async enrichment — three times a day (URLSCAN_ENRICHMENT_CRONS).
// Finds URL entities that have completed enrichment but no urlscan data,
// submits up to URLSCAN_ENRICHMENT_MAX_PER_RUN for scanning, waits 60s, then
// retrieves and stores results.
//
// Submits are UNLISTED (urlscan.ts), so this lane spends the same key-wide
// unlisted quota as the clone-watch submit and recheck lanes. Its share and
// schedule are declared once in ./urlscan-enrichment-schedule.ts and summed
// with every other spender in apps/web/lib/clone-watch/urlscan-budget.ts.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { submitURLScan, retrieveURLScan } from "../urlscan";
import { logCost, ENGINE_PRICING } from "../cost-log";
import { withAxiomLogging } from "./with-axiom-logging";
import {
  URLSCAN_ENRICHMENT_CRONS,
  URLSCAN_ENRICHMENT_MAX_PER_RUN,
} from "./urlscan-enrichment-schedule";

const MAX_URLS_PER_RUN = URLSCAN_ENRICHMENT_MAX_PER_RUN;

// inngest-finish-budget: 41 boundaries — 1 static + 2 per-URL steps
// (submit, retrieve) x MAX_URLS_PER_RUN (20).
export const urlscanEnrichment = inngest.createFunction(
  {
    id: "pipeline-urlscan-enrichment",
    timeouts: { finish: "22m" },
    name: "Pipeline: URLScan.io Async Enrichment",
    concurrency: { limit: 1 },
    // urlscan's UNLISTED quota is 60/min, 100/hour, 1,000/day (/user/quotas,
    // 2026-09-26 — the "free tier ~100/day" this comment used to quote was
    // wrong by 10x). The lane is cron-only — no manual-trigger event — so its
    // spend is URLSCAN_ENRICHMENT_MAX_PER_RUN × three fires a day, and
    // urlscanBudget.test.ts proves that fits beside the clone-watch lanes.
    // rateLimit (DISCARDS) 1/10m: acceptable on a cron-only fn, where the only
    // extra invocations are replays/redeploy double-fires. The throttle counts
    // RUNS, not submissions (docs/inngest-brakes.md §glossary): 50 runs/h is
    // not a submission lid, it is never reached by a three-a-day cron.
    rateLimit: { limit: 1, period: "10m" },
    throttle: { limit: 50, period: "1h", key: "urlscan-submissions" },
  },
  // 03:00 / 15:00 / 21:00 UTC — declared once in urlscan-enrichment-schedule.ts
  // (moved off the recheck's :30 hours in #1231). Pending-status queue is
  // self-draining + capped per run.
  URLSCAN_ENRICHMENT_CRONS.map((cron) => ({ cron })),
  withAxiomLogging(
    { fnId: "pipeline-urlscan-enrichment" },
    async ({ step }) => {
      if (!featureFlags.urlScanIO) {
        return { skipped: true, reason: "urlScanIO feature flag disabled" };
      }

      if (!process.env.URLSCAN_API_KEY) {
        return { skipped: true, reason: "URLSCAN_API_KEY not set" };
      }

      // Step 1: Find URL entities with completed enrichment but no urlscan data
      const urlEntities = await step.run("fetch-url-entities", async () => {
        const supabase = createServiceClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("scam_entities")
          .select("id, normalized_value, enrichment_data")
          .eq("entity_type", "url")
          .eq("enrichment_status", "completed")
          // report_count >= 2 (lowered from 3, 2026-07-12 fleet review) — kept in
          // lockstep with entity-enrichment's gate. URL entities never reached
          // report_count 3 (corpus max 2), so this stage had 0 paid calls
          // all-time; >=2 lets it fire on twice-seen URLs that entity-enrichment
          // has completed. Bounded by the urlScanIO flag + throttle.
          .gte("report_count", 2)
          .order("report_count", { ascending: false })
          .limit(MAX_URLS_PER_RUN);

        if (error) {
          logger.error("Failed to fetch URL entities for urlscan", {
            error: String(error),
          });
          throw new Error(error.message);
        }

        // Filter out entities that already have urlscan data
        return (data || [])
          .filter((row) => {
            const enrichment = row.enrichment_data as Record<
              string,
              unknown
            > | null;
            return !enrichment?.urlscan;
          })
          .map((row) => ({
            id: row.id,
            url: row.normalized_value as string,
          }));
      });

      if (urlEntities.length === 0) {
        return { scanned: 0, reason: "no URL entities need urlscan" };
      }

      // Step 2: Submit URLs for scanning — ONE step.run per URL (#520 H2a).
      // Previously the whole submit loop sat in a single step; an Inngest retry
      // of that step re-submitted every URL to URLScan, double-paying. Per-URL
      // steps are memoised once successful, so a retry skips already-submitted
      // URLs. Step id keyed on the stable entity id (deterministic). Cost is
      // logged inside the step so a retry doesn't re-log either.
      const submissions: { entityId: number; uuid: string; url: string }[] = [];
      for (const entity of urlEntities) {
        const submission = await step.run(`submit-${entity.id}`, async () => {
          const result = await submitURLScan(entity.url);
          if (!result) return null;
          // Awaited: this row is the lane's entry in the unlisted-urlscan
          // ledger the manual-trigger budget guard reads
          // (urlscan-budget.ts); a fire-and-forget write can be lost.
          await logCost({
            feature: "urlscan-enrichment",
            provider: "urlscan",
            operation: "scan.submit",
            units: 1,
            estimatedCostUsd: ENGINE_PRICING.URLSCAN_SUBMIT_USD,
            metadata: { entity_id: entity.id },
          });
          return { entityId: entity.id, uuid: result.uuid, url: entity.url };
        });
        if (submission) submissions.push(submission);
      }

      if (submissions.length === 0) {
        return { scanned: 0, reason: "no URLs were successfully submitted" };
      }

      // Step 3: Wait 60s for scans to complete
      await step.sleep("wait-for-scans", "60s");

      // Step 4: Retrieve + merge — ONE step.run per submission (#520 H2a/H2b).
      // Per-URL steps mean a retry doesn't re-fetch already-retrieved scans.
      // The merge uses the atomic merge_entity_enrichment_data RPC (v161)
      // instead of select→spread→update, closing the read-modify-write race
      // where a concurrent entity-enrichment write clobbered the urlscan key.
      let retrieved = 0;
      let failed = 0;
      for (const sub of submissions) {
        const ok = await step.run(`retrieve-${sub.entityId}`, async () => {
          const supabase = createServiceClient();
          if (!supabase) return false;
          try {
            const result = await retrieveURLScan(sub.uuid);
            if (!result) return false;

            const { error } = await supabase.rpc(
              "merge_entity_enrichment_data",
              {
                p_entity_id: sub.entityId,
                p_key: "urlscan",
                p_value: result,
              },
            );
            if (error) {
              logger.error("URLScan merge RPC failed", {
                entityId: sub.entityId,
                error: error.message,
              });
              return false;
            }
            return true;
          } catch (err) {
            logger.error("URLScan retrieval failed for entity", {
              entityId: sub.entityId,
              uuid: sub.uuid,
              error: String(err),
            });
            return false;
          }
        });
        if (ok) retrieved++;
        else failed++;
      }

      const retrievalResults = { retrieved, failed };

      logger.info("URLScan enrichment complete", {
        submitted: submissions.length,
        ...retrievalResults,
      });

      return { submitted: submissions.length, ...retrievalResults };
    },
  ),
);
