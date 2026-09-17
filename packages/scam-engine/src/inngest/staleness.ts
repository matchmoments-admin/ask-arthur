// Staleness cron — daily, marks URLs not seen in any feed for 7 days as inactive.
// Preserves community-validated URLs (3+ reporters), HIGH_RISK from Claude
// analysis, and sole-source rows of staleness-exempt feeds (v262).
//
// Batched since v308 (#1156): the single unbounded UPDATE (18 s idle) sat in
// the window where the tier-12h bulk IOC mirrors land — GHA dispatches the
// 00:00 tick 1–4 h late, so 84K–136K scam_urls upserts arrive at 03–04 UTC —
// and under that contention it was finish-cancelled every day Sep 14–17.
// A cancelled unbounded UPDATE rolls back, so no URL was marked stale for four
// days. Now: bounded batches, each its own transaction, looped inside ONE
// in-step budget (staleness-sweep.ts); a tail that doesn't fit drains next tick.
//
// NOTE: archive_old_urls() is available as a manual SQL function in the database
// for archiving feed URLs older than 180 days. Run it from the Supabase SQL Editor:
//   SELECT archive_old_urls(180);

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { withAxiomLogging } from "./with-axiom-logging";
import { budgetedStep } from "./step-budget";
import { runStalenessSweep, stalenessRpcBatch } from "./staleness-sweep";

const STALE_DAYS = 7;
const BATCH_LIMIT = 2000;
// In-step: the loop runs inside ONE step.run, so the bound is the route's
// maxDuration and the clock starts at step entry (step-budget.ts). Finish
// budget floor = 1 boundary × 30 s + 120 s + 60 s slack = 210 s < 4 m.
const STALENESS_WALL_CLOCK_MS = 120_000;

// inngest-finish-budget: 1 boundaries — the single budgetedStep "mark-stale-urls"
// (the batch loop runs INSIDE it; no per-item steps).

export const stalenessCheck = inngest.createFunction(
  {
    id: "pipeline-staleness-check",
    concurrency: { limit: 1 },
    timeouts: { finish: "4m" },
    name: "Pipeline: Mark Stale URLs",
  },
  // First of the staggered staleness trio: URLs 05:40, IPs 05:50, wallets
  // 06:05 UTC. Moved off 03:00–03:20 in v308/#1156 — that hour is where the
  // bulk IOC mirror scrapers land (see header), and `:00`/`:10` are the
  // account-concurrency pileup. 05:30 / 06:00 / 06:45 are taken by other crons.
  { cron: "40 5 * * *" },
  withAxiomLogging({ fnId: "pipeline-staleness-check" }, async ({ step }) => {
    if (!featureFlags.dataPipeline) {
      return { skipped: true, reason: "dataPipeline feature flag disabled" };
    }

    const result = await budgetedStep(
      step,
      "mark-stale-urls",
      STALENESS_WALL_CLOCK_MS,
      async (budget) => {
        const supabase = createServiceClient();
        if (!supabase) {
          logger.warn("Supabase not configured, skipping staleness check");
          return { skipped: true as const };
        }
        const sweep = await runStalenessSweep({
          budget,
          batchLimit: BATCH_LIMIT,
          runBatch: stalenessRpcBatch(supabase, "mark_stale_urls", {
            p_stale_days: STALE_DAYS,
            p_limit: BATCH_LIMIT,
          }),
        });
        logger.info("Staleness check complete", { ...sweep });
        return sweep;
      },
    );

    return result;
  }),
);
