// Staleness cron for crypto wallets — daily, marks wallets not seen in any feed
// for 14 days as inactive. Preserves high-confidence wallets.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const stalenessCheckWallets = inngest.createFunction(
  {
    id: "pipeline-staleness-check-wallets",
    name: "Pipeline: Mark Stale Crypto Wallets",
  },
  { cron: "0 3 * * *" }, // Daily at 3am UTC
  async ({ step }) => {
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
  }
);
