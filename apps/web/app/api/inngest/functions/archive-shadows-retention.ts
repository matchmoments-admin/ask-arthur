// Nightly archive-shadow housekeeping for 6 medium-volume tables
// (Phase 2.5).
//
// Calls archive_secondary_tables_batch() in a loop until all 6 tables
// report 0 moved rows. Each call is bounded to 5000 rows per table to
// keep transaction time short and avoid blocking autovacuum.
//
// Tables + retention windows (per migration-v118):
//   flagged_ads                 365d (last_flagged_at)
//   deepfake_detections         365d (created_at)
//   media_analyses              180d (created_at; PII-sensitive shorter)
//   scan_results                365d (scanned_at)
//   verdict_feedback            730d (created_at; forensic / training)
//   brand_impersonation_alerts  365d (created_at)
//
// Schedule: 05:00 UTC nightly (15:00 AEST). Sits at the tail of the
// retention pipeline:
//   02:30 feed-retention
//   03:15 phone-footprint-retention
//   03:45 reddit-processed-posts-retention
//   04:00 cost-telemetry-retention
//   04:30 telco-events-retention
//   05:00 archive-shadows-retention  ← this file
//
// Plan reference: phase 2.5 of the data-model improvement plan.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "@askarthur/scam-engine/inngest/client";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";

const BATCH_SIZE = 5000;
const LOOP_GUARD = 50;

type ArchiveResult = { table_name: string; rows_moved: number };

export const archiveShadowsRetention = inngest.createFunction(
  {
    id: "archive-shadows-retention",
    timeouts: { finish: "4m" },
    name: "Archive shadows: nightly housekeeping (6 tables)",
    retries: 2,
  },
  { cron: "0 5 * * *" },
  withAxiomLogging({ fnId: "archive-shadows-retention" }, async ({ step }) => {
    const totals: Record<string, number> = {
      flagged_ads: 0,
      deepfake_detections: 0,
      media_analyses: 0,
      scan_results: 0,
      verdict_feedback: 0,
      brand_impersonation_alerts: 0,
    };

    for (let iter = 0; iter < LOOP_GUARD; iter++) {
      const results = await step.run(`archive-batch-${iter}`, async () => {
        const supabase = createServiceClient();
        if (!supabase) throw new Error("supabase service client unavailable");
        const { data, error } = await supabase.rpc("archive_secondary_tables_batch", {
          p_batch_size: BATCH_SIZE,
        });
        if (error) throw new Error(`archive_secondary_tables_batch failed: ${error.message}`);
        return (data as ArchiveResult[]) ?? [];
      });

      let any = false;
      for (const r of results) {
        totals[r.table_name] = (totals[r.table_name] ?? 0) + r.rows_moved;
        if (r.rows_moved > 0) any = true;
      }
      if (!any) break;
    }

    logger.info("archive-shadows-retention: complete", totals);
    return totals;
  }),
);
