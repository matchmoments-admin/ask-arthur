// Risk scorer — every 6h, recomputes composite risk scores for entities
// that have received new reports since their last scoring.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

const MAX_ENTITIES_PER_RUN = 100;

export const riskScorer = inngest.createFunction(
  {
    id: "pipeline-risk-scorer",
    name: "Pipeline: Compute Entity Risk Scores",
    concurrency: { limit: 1 },
  },
  { cron: "0 */6 * * *" }, // Every 6 hours
  async ({ step }) => {
    if (!featureFlags.riskScoring) {
      return { skipped: true, reason: "riskScoring feature flag disabled" };
    }

    // Step 1: Find entities needing re-scoring
    // Entities where last_seen > risk_scored_at (or never scored)
    const entityIds = await step.run("fetch-entities-to-score", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [];

      const { data, error } = await supabase
        .from("scam_entities")
        .select("id")
        .or("risk_scored_at.is.null,last_seen.gt.risk_scored_at")
        .gte("report_count", 1)
        .order("report_count", { ascending: false })
        .limit(MAX_ENTITIES_PER_RUN);

      if (error) {
        logger.error("Failed to fetch entities for scoring", {
          error: String(error),
        });
        throw new Error(error.message);
      }

      return (data || []).map((row) => row.id as number);
    });

    if (entityIds.length === 0) {
      return { scored: 0, reason: "no entities need re-scoring" };
    }

    // Step 2: Compute scores via RPC (batched to avoid timeout)
    const results = await step.run("compute-scores", async () => {
      const supabase = createServiceClient();
      if (!supabase) return { scored: 0, failed: 0 };

      let scored = 0;
      let failed = 0;

      for (const entityId of entityIds) {
        try {
          const { data, error } = await supabase.rpc(
            "compute_entity_risk_score",
            { p_entity_id: entityId }
          );

          if (error) {
            logger.error("Risk score computation failed", {
              entityId,
              error: String(error),
            });
            failed++;
            continue;
          }

          const result = data as { error?: string } | null;
          if (result?.error) {
            failed++;
          } else {
            scored++;
          }
        } catch (err) {
          logger.error("Risk score RPC error", {
            entityId,
            error: String(err),
          });
          failed++;
        }
      }

      return { scored, failed };
    });

    logger.info("Risk scoring complete", {
      total: entityIds.length,
      ...results,
    });

    return { total: entityIds.length, ...results };
  }
);
