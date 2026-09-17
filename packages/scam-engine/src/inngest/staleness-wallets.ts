// Staleness cron for crypto wallets — daily, marks wallets not seen in any feed
// for 14 days as inactive. Preserves high-confidence wallets.
//
// v308 (#1156): brought onto the shared bounded-batch sweep (staleness-sweep.ts)
// so the three staleness crons are one shape. This one was completing fine
// (small table); the change here is uniformity, not a fix.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { withAxiomLogging } from "./with-axiom-logging";
import { budgetedStep } from "./step-budget";
import { runStalenessSweep, stalenessRpcBatch } from "./staleness-sweep";

const STALE_DAYS = 14;
const BATCH_LIMIT = 5000;
// In-step budget (see staleness.ts). Floor = 30 + 120 + 60 = 210 s < 4 m.
const STALENESS_WALL_CLOCK_MS = 120_000;

// inngest-finish-budget: 1 boundaries — the single budgetedStep "mark-stale-wallets"
// (the batch loop runs INSIDE it; no per-item steps).

export const stalenessCheckWallets = inngest.createFunction(
  {
    id: "pipeline-staleness-check-wallets",
    concurrency: { limit: 1 },
    timeouts: { finish: "4m" },
    name: "Pipeline: Mark Stale Crypto Wallets",
  },
  // Staggered trio: URLs 05:40, IPs 05:50, wallets 06:05 UTC (v308 — see
  // staleness.ts for why it left 03:20).
  { cron: "5 6 * * *" },
  withAxiomLogging(
    { fnId: "pipeline-staleness-check-wallets" },
    async ({ step }) => {
      if (!featureFlags.dataPipeline) {
        return { skipped: true, reason: "dataPipeline feature flag disabled" };
      }

      const result = await budgetedStep(
        step,
        "mark-stale-wallets",
        STALENESS_WALL_CLOCK_MS,
        async (budget) => {
          const supabase = createServiceClient();
          if (!supabase) {
            logger.warn(
              "Supabase not configured, skipping wallet staleness check",
            );
            return { skipped: true as const };
          }
          const sweep = await runStalenessSweep({
            budget,
            batchLimit: BATCH_LIMIT,
            runBatch: stalenessRpcBatch(supabase, "mark_stale_crypto_wallets", {
              p_stale_days: STALE_DAYS,
              p_limit: BATCH_LIMIT,
            }),
          });
          logger.info("Wallet staleness check complete", { ...sweep });
          return sweep;
        },
      );

      return result;
    },
  ),
);
