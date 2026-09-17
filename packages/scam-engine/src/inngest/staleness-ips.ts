// Staleness cron for IPs — daily, marks IPs not seen in any feed for 7 days as inactive.
// Preserves high-confidence IPs (confidence_level 'high' or 'confirmed').
//
// v308 (#1156): the RPC's batch subquery now orders by last_seen_in_feed so
// the planner uses the partial idx_scam_ips_staleness. With `ORDER BY id` it
// walked the whole 1.13M-row pkey looking for 5000 matches — 34.5 s warm and
// `rows=0` on a drained day — which cold at 03:10 blew the 4 m finish on 7/7
// runs. The loop itself moved into staleness-sweep.ts and runs inside ONE
// in-step budget; the old MAX_BATCHES backstop was, by its own comment, "not
// a within-budget guarantee".

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { withAxiomLogging } from "./with-axiom-logging";
import { budgetedStep } from "./step-budget";
import { runStalenessSweep, stalenessRpcBatch } from "./staleness-sweep";

const STALE_DAYS = 7;
const BATCH_LIMIT = 5000;
// In-step budget (see staleness.ts). Floor = 30 + 120 + 60 = 210 s < 4 m.
const STALENESS_WALL_CLOCK_MS = 120_000;

// inngest-finish-budget: 1 boundaries — the single budgetedStep "mark-stale-ips"
// (the batch loop runs INSIDE it; no per-item steps).

export const stalenessCheckIPs = inngest.createFunction(
  {
    id: "pipeline-staleness-check-ips",
    concurrency: { limit: 1 },
    timeouts: { finish: "4m" },
    name: "Pipeline: Mark Stale IPs",
  },
  // Staggered trio: URLs 05:40, IPs 05:50, wallets 06:05 UTC (v308 — see
  // staleness.ts for why it left 03:10).
  { cron: "50 5 * * *" },
  withAxiomLogging(
    { fnId: "pipeline-staleness-check-ips" },
    async ({ step }) => {
      if (!featureFlags.dataPipeline) {
        return { skipped: true, reason: "dataPipeline feature flag disabled" };
      }

      const result = await budgetedStep(
        step,
        "mark-stale-ips",
        STALENESS_WALL_CLOCK_MS,
        async (budget) => {
          const supabase = createServiceClient();
          if (!supabase) {
            logger.warn("Supabase not configured, skipping IP staleness check");
            return { skipped: true as const };
          }
          const sweep = await runStalenessSweep({
            budget,
            batchLimit: BATCH_LIMIT,
            runBatch: stalenessRpcBatch(supabase, "mark_stale_ips", {
              p_stale_days: STALE_DAYS,
              p_limit: BATCH_LIMIT,
            }),
          });
          logger.info("IP staleness check complete", { ...sweep });
          return sweep;
        },
      );

      return result;
    },
  ),
);
