// Staleness cron for crypto wallets — daily, marks wallets not seen in any feed
// for 14 days as inactive. Preserves high-confidence wallets.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { withAxiomLogging } from "./with-axiom-logging";

export const stalenessCheckWallets = inngest.createFunction(
  {
    id: "pipeline-staleness-check-wallets",
    concurrency: { limit: 1 },
    timeouts: { finish: "4m" },
    name: "Pipeline: Mark Stale Crypto Wallets",
  },
  // Staggered off the 0 3 trio (#524): URLs 0 3, IPs 10 3, wallets 20 3.
  { cron: "20 3 * * *" },
  withAxiomLogging({ fnId: "pipeline-staleness-check-wallets" }, async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await step.run("mark-stale-wallets", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("Supabase not configured, skipping wallet staleness check");
        return { skipped: true };
      }

      const { data, error } = await supabase.rpc("mark_stale_crypto_wallets", {
        p_stale_days: 14,
      });

      if (error) {
        logger.error("Wallet staleness check failed", {
          error: String(error),
        });
        throw new Error(`Wallet staleness RPC failed: ${error.message}`);
      }

      logger.info("Wallet staleness check complete", { result: data });
      return data;
    });

    return result;
  })
);
