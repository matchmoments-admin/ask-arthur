// Staleness cron for IPs — daily, marks IPs not seen in any feed for 7 days as inactive.
// Preserves high-confidence IPs (confidence_level 'high' or 'confirmed').

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const stalenessCheckIPs = inngest.createFunction(
  {
    id: "pipeline-staleness-check-ips",
    name: "Pipeline: Mark Stale IPs",
  },
  { cron: "0 3 * * *" }, // Daily at 3am UTC
  async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await step.run("mark-stale-ips", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping IP staleness check");
        return { skipped: true };
      }

      const { data, error } = await supabase.rpc("mark_stale_ips", {
        p_stale_days: 7,
      });

      if (error) {
        logger.error("IP staleness check failed", { error: String(error) });
        throw new Error(`IP staleness RPC failed: ${error.message}`);
      }

      logger.info("IP staleness check complete", { result: data });
      return data;
    });

    return result;
  }
);
