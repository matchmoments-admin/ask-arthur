// Feedback triage MV refresh — runs every 5 min so the /admin/feedback page
// reflects new disagreements within one cron tick. The materialised view
// itself is defined in migration-v94; this function only calls the
// SECURITY DEFINER RPC that wraps REFRESH MATERIALIZED VIEW CONCURRENTLY.
//
// Concurrency=1 because two simultaneous REFRESH CONCURRENTLY calls would
// serialise on the MV anyway; making it explicit prevents Inngest queueing
// duplicates if a refresh ever takes longer than the 5-min interval.

import { inngest } from "./client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { withAxiomLogging } from "./with-axiom-logging";

export const feedbackTriageRefresh = inngest.createFunction(
  {
    id: "feedback-triage-refresh",
    name: "Feedback Triage: Refresh Materialised View",
    concurrency: 1,
  },
  // Cadence relaxed */5 → */15 (#524). The unconditional REFRESH MATERIALIZED
  // VIEW CONCURRENTLY did real I/O on the hot feedback_triage_queue MV every 5
  // min (~288 runs/day, almost all no-ops) to serve one internal /admin page;
  // 15 min is ample freshness there and cuts the refresh load ~3×. (A
  // change-guard early-exit would cut it further — deferred follow-up.)
  { cron: "*/15 * * * *" },
  withAxiomLogging({ fnId: "feedback-triage-refresh" }, async ({ step }) => {
    return await step.run("refresh-mv", async () => {
      const supabase = createServiceClient();
      if (!supabase) {
        logger.warn("feedback-triage-refresh: supabase not configured, skipping");
        return { skipped: true, reason: "supabase_unavailable" };
      }

      const { error } = await supabase.rpc("refresh_feedback_triage_queue");
      if (error) {
        throw new Error(`refresh_feedback_triage_queue failed: ${error.message}`);
      }
      return { ok: true };
    });
  }),
);
