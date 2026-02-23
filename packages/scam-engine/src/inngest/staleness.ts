// Staleness cron — daily, marks URLs not seen in any feed for 7 days as inactive,
// then archives feed-sourced URLs older than 90 days.
// Preserves community-validated URLs (3+ reporters) and HIGH_RISK from Claude analysis.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const stalenessCheck = inngest.createFunction(
  {
    id: "pipeline-staleness-check",
    name: "Pipeline: Mark Stale & Archive Old URLs",
  },
  { cron: "0 3 * * *" }, // Daily at 3am UTC
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const staleResult = await step.run("mark-stale-urls", async () => {
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

    const archiveResult = await step.run("archive-old-urls", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping archive");
        return { skipped: true };
      }

      const { data, error } = await supabase.rpc("archive_old_urls", {
        p_archive_days: 90,
      });

      if (error) {
        logger.error("Archive old URLs failed", { error: String(error) });
        throw new Error(`Archive RPC failed: ${error.message}`);
      }

      logger.info("Archive old URLs complete", { result: data });
      return data;
    });

    return { stale: staleResult, archive: archiveResult };
  }
);
