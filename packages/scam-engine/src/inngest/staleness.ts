// Staleness cron — daily, marks URLs not seen in any feed for 7 days as inactive.
// Preserves community-validated URLs (3+ reporters) and HIGH_RISK from Claude analysis.
//
// NOTE: archive_old_urls() is available as a manual SQL function in the database
// for archiving feed URLs older than 180 days. Run it from the Supabase SQL Editor:
//   SELECT archive_old_urls(180);

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const stalenessCheck = inngest.createFunction(
  {
    id: "pipeline-staleness-check",
    name: "Pipeline: Mark Stale URLs",
  },
  { cron: "0 3 * * *" }, // Daily at 3am UTC
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await step.run("mark-stale-urls", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping staleness check");
        return { skipped: true };
      }

      const { data, error } = await supabase.rpc("mark_stale_urls", {
        p_stale_days: 7,
      });

      if (error) {
        logger.error("Staleness check failed", { error: String(error) });
        throw new Error(`Staleness RPC failed: ${error.message}`);
      }

      logger.info("Staleness check complete", { result: data });
      return data;
    });

    return result;
  }
);
