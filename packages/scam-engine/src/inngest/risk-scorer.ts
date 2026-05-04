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

    // Step 1: Find entities needing re-scoring.
    // Entities where last_seen > risk_scored_at OR never scored.
    //
    // Implementation note: PostgREST's `.or()` filter syntax is
    // `column.op.value` and does NOT support cross-column comparisons —
    // the third dot-segment is sent as a literal value, so an attempt
    // like `.or("risk_scored_at.is.null,last_seen.gt.risk_scored_at")`
    // makes Postgres try to coerce the string "risk_scored_at" into a
    // timestamptz and fail. We split into two queries and merge in JS.
    // Cross-column comparisons that need to live in SQL belong in an
    // RPC; not worth the migration overhead for this small set.
    const entityIds = await step.run("fetch-entities-to-score", async () => {
      const supabase = createServiceClient();
      if (!supabase) return [];

      // Query A: never scored — take by report_count desc.
      const neverScored = await supabase
        .from("scam_entities")
        .select("id, report_count")
        .is("risk_scored_at", null)
        .gte("report_count", 1)
        .order("report_count", { ascending: false })
        .limit(MAX_ENTITIES_PER_RUN);

      if (neverScored.error) {
        logger.error("Failed to fetch never-scored entities", {
          error: String(neverScored.error),
        });
        throw new Error(neverScored.error.message);
      }

      // Query B: scored but stale — fetch a recent window (ordered by
      // last_seen desc) then filter `last_seen > risk_scored_at` in JS.
      // The window of MAX_ENTITIES_PER_RUN guarantees we don't miss any
      // ranking-relevant rows: if more than that many are stale, the
      // cron simply catches up over the next few runs.
      const stale = await supabase
        .from("scam_entities")
        .select("id, last_seen, risk_scored_at")
        .not("risk_scored_at", "is", null)
        .gte("report_count", 1)
        .order("last_seen", { ascending: false })
        .limit(MAX_ENTITIES_PER_RUN);

      if (stale.error) {
        logger.error("Failed to fetch stale entities", {
          error: String(stale.error),
        });
        throw new Error(stale.error.message);
      }

      const staleIds = (stale.data ?? [])
        .filter((r) => {
          if (!r.last_seen || !r.risk_scored_at) return false;
          return new Date(r.last_seen) > new Date(r.risk_scored_at);
        })
        .map((r) => r.id as number);

      const neverIds = (neverScored.data ?? []).map((r) => r.id as number);

      // Merge, dedupe, cap at the per-run limit. Never-scored leads
      // because a brand-new entity with high report_count is more
      // urgent than a stale-but-already-scored one.
      const seen = new Set<number>();
      const merged: number[] = [];
      for (const id of [...neverIds, ...staleIds]) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= MAX_ENTITIES_PER_RUN) break;
      }
      return merged;
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
