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
  })
);
