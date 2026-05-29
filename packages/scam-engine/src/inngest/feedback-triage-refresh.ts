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
    // Drop a backed-up tick instead of stacking REFRESHes (PR-B breaker).
    singleton: { mode: "skip" },
    timeouts: { finish: "4m" },
  },
  // Cadence relaxed */5 → */15 (#524) → */30 (PR-C). On top of the cadence cut,
  // a change-guard early-exits the tick when the MV already reflects the latest
  // disagreement feedback — so most ticks become two cheap index lookups
  // instead of a real REFRESH MATERIALIZED VIEW CONCURRENTLY on the hot MV.
  { cron: "*/30 * * * *" },
  withAxiomLogging({ fnId: "feedback-triage-refresh" }, async ({ step }) => {
    const supabase = createServiceClient();
    if (!supabase) {
      logger.warn("feedback-triage-refresh: supabase not configured, skipping");
      return { skipped: true, reason: "supabase_unavailable" };
    }

    // Change-guard (PR-C): is there disagreement feedback newer than what the
    // MV already holds? Both columns are indexed (verdict_feedback.created_at
    // v47; feedback_triage_queue.feedback_created_at v94), so this is two
    // index lookups. The MV only contains user_says <> 'correct' rows, so its
    // max feedback_created_at IS the latest disagreement already reflected.
    const needsRefresh = await step.run("check-new-feedback", async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: latestFb } = await supabase
        .from("verdict_feedback")
        .select("created_at")
        .neq("user_says", "correct")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latestFb?.created_at) return false; // no recent disagreement at all
      const { data: mvLatest } = await supabase
        .from("feedback_triage_queue")
        .select("feedback_created_at")
        .order("feedback_created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!mvLatest?.feedback_created_at) return true; // MV empty → populate it
      return (
        new Date(latestFb.created_at).getTime() >
        new Date(mvLatest.feedback_created_at).getTime()
      );
    });

    if (!needsRefresh) {
      return { skipped: true, reason: "no_new_feedback" };
    }

    return await step.run("refresh-mv", async () => {
      const { error } = await supabase.rpc("refresh_feedback_triage_queue");
      if (error) {
        throw new Error(`refresh_feedback_triage_queue failed: ${error.message}`);
      }
      return { ok: true };
    });
  }),
);
