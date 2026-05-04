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

export const feedbackTriageRefresh = inngest.createFunction(
  {
    id: "feedback-triage-refresh",
    name: "Feedback Triage: Refresh Materialised View",
    concurrency: 1,
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
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
  },
);
