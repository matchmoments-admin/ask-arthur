// Nightly cost_telemetry retention housekeeping.
//
// Two RPCs run in order:
//   1. refresh_cost_telemetry_daily_rollup(p_days=7) — re-aggregates the
//      last 7 days of raw cost_telemetry into the cost_telemetry_daily_rollup
//      table (UPSERT on (day, feature, provider)). 7-day window covers
//      any cron-skipped nights.
//   2. prune_cost_telemetry(p_days=90) — DELETE raw rows >90 days old.
//      The rollup has already captured them via step 1.
//
// Long-range (>90d) cost analytics queries should hit the rollup table
// directly; ad-hoc 90d queries continue to use the daily_cost_summary
// view over raw cost_telemetry.
//
// Schedule: 04:00 UTC nightly (14:00 AEST). After feed-retention (02:30),
// phone-footprint-retention (03:15), and reddit-processed-posts-retention
// (03:45), all of which are independent.
//
// Plan reference: phase 2.1 of the data-model improvement plan.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";

const ROLLUP_WINDOW_DAYS = 7;
const RAW_RETENTION_DAYS = 90;

export const costTelemetryRetention = inngest.createFunction(
  {
    id: "cost-telemetry-retention",
    timeouts: { finish: "4m" },
    name: "Cost Telemetry: Nightly rollup + 90-day prune",
    retries: 2,
  },
  { cron: "0 4 * * *" },
  withAxiomLogging({ fnId: "cost-telemetry-retention" }, async ({ step }) => {
    const rolled = await step.run("refresh-rollup", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("refresh_cost_telemetry_daily_rollup", {
        p_days: ROLLUP_WINDOW_DAYS,
      });
      if (error) throw new Error(`refresh_cost_telemetry_daily_rollup failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    const pruned = await step.run("prune-raw", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("prune_cost_telemetry", {
        p_days: RAW_RETENTION_DAYS,
      });
      if (error) throw new Error(`prune_cost_telemetry failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    logger.info("cost-telemetry-retention: complete", {
      rolledUpRows: rolled,
      prunedRawRows: pruned,
      rollupWindowDays: ROLLUP_WINDOW_DAYS,
      rawRetentionDays: RAW_RETENTION_DAYS,
    });

    return {
      rolledUpRows: rolled,
      prunedRawRows: pruned,
    };
  }),
);
