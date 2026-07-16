// Staleness cron for IPs — daily, marks IPs not seen in any feed for 7 days as inactive.
// Preserves high-confidence IPs (confidence_level 'high' or 'confirmed').

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { withAxiomLogging } from "./with-axiom-logging";

export const stalenessCheckIPs = inngest.createFunction(
  {
    id: "pipeline-staleness-check-ips",
    concurrency: { limit: 1 },
    timeouts: { finish: "4m" },
    name: "Pipeline: Mark Stale IPs",
  },
  // Staggered off the 0 3 trio (#524): URLs 0 3, IPs 10 3, wallets 20 3 — so
  // the three staleness crons don't fire simultaneously against the DB.
  { cron: "10 3 * * *" },
  withAxiomLogging({ fnId: "pipeline-staleness-check-ips" }, async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await step.run("mark-stale-ips", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping IP staleness check");
        return { skipped: true };
      }

      // mark_stale_ips is now a bounded batch (v234) — a single unbounded
      // UPDATE of ~9.7K rows against the GIN-indexed scam_ips table was
      // blowing the pooler statement timeout. Loop until a short batch signals
      // the stale set has drained; each RPC call is its own transaction, so a
      // slow chunk can't poison the run. MAX_BATCHES caps worst-case work well
      // under the 4m Inngest finish budget.
      const BATCH_LIMIT = 5000;
      const MAX_BATCHES = 20;
      let totalDeactivated = 0;
      let batches = 0;

      for (; batches < MAX_BATCHES; batches++) {
        const { data, error } = await supabase.rpc("mark_stale_ips", {
          p_stale_days: 7,
          p_limit: BATCH_LIMIT,
        });

        if (error) {
          // Log the structured fields, not String(error) — a PostgrestError
          // stringifies to "[object Object]", which masked the real cause for
          // weeks. message/code/details/hint are the diagnostic surface.
          logger.error("IP staleness check failed", {
            message: error.message,
            code: error.code,
            details: error.details,
            hint: error.hint,
            batches,
            totalDeactivated,
          });
          throw new Error(`IP staleness RPC failed: ${error.message}`);
        }

        const deactivated = (data as { deactivated_count?: number } | null)
          ?.deactivated_count ?? 0;
        totalDeactivated += deactivated;
        if (deactivated < BATCH_LIMIT) break; // drained
      }

      logger.info("IP staleness check complete", {
        totalDeactivated,
        batches: batches + 1,
      });
      return { deactivated_count: totalDeactivated, batches: batches + 1 };
    });

    return result;
  })
);
