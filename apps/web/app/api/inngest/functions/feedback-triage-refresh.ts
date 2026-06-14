// Feedback triage MV refresh — runs every 30 min (relaxed */5 → */15 #524 →
// */30 PR-C) so the /admin/feedback page reflects new disagreements. The
// materialised view is defined in migration-v94 (WHERE created_at > now()-30d
// AND user_says <> 'correct'); this function calls the SECURITY DEFINER RPC
// that wraps REFRESH MATERIALIZED VIEW CONCURRENTLY.
//
// A change-guard (PR-C) early-exits the tick when the MV is already current,
// so most ticks are a few cheap index lookups instead of a full REFRESH. The
// guard must account for the MV's 30-day sliding window — rows aged past 30d
// have to be REFRESHed OUT even when no new feedback arrives — and it fails
// SAFE (refreshes) on any guard-query error so a transient DB blip can't leave
// the MV silently stale. singleton:{mode:"skip"} drops an overlapping tick.

import { inngest } from "@askarthur/scam-engine/inngest/client";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { withAxiomLogging } from "@askarthur/scam-engine/inngest/with-axiom-logging";

export const feedbackTriageRefresh = inngest.createFunction(
  {
    id: "feedback-triage-refresh",
    name: "Feedback Triage: Refresh Materialised View",
    concurrency: 1,
    // Drop a backed-up tick instead of stacking REFRESHes (PR-B breaker).
    singleton: { mode: "skip" },
    timeouts: { finish: "4m" },
  },
  // Cadence relaxed */5 → */15 (#524) → */30 (PR-C) → hourly (invocation cut).
  // On top of the cadence cut, a change-guard early-exits the tick when the MV
  // already reflects the latest disagreement feedback — so most ticks become two
  // cheap index lookups instead of a real REFRESH MATERIALIZED VIEW CONCURRENTLY
  // on the hot MV. This is an admin triage view (30-day sliding window, decoupled
  // from cron cadence), so hourly freshness is ample — no data loss, just halved
  // tick volume (1,440 → 720 runs/mo).
  { cron: "0 * * * *" },
  withAxiomLogging({ fnId: "feedback-triage-refresh" }, async ({ step }) => {
    const supabase = createServiceClient();
    if (!supabase) {
      logger.warn("feedback-triage-refresh: supabase not configured, skipping");
      return { skipped: true, reason: "supabase_unavailable" };
    }

    // Change-guard (PR-C). All columns indexed (verdict_feedback.created_at v47;
    // feedback_triage_queue.feedback_created_at v94), so this is 3 index lookups
    // vs a REFRESH MATERIALIZED VIEW CONCURRENTLY. The MV is a 30-day sliding
    // window of disagreements (user_says <> 'correct'), so we refresh when a new
    // disagreement arrives OR a materialised row has aged past the window.
    const needsRefresh = await step.run("check-new-feedback", async () => {
      const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const since = new Date(cutoffMs).toISOString();

      // Newest disagreement in the source table within the 30-day window.
      const { data: latestFb, error: fbErr } = await supabase
        .from("verdict_feedback")
        .select("created_at")
        .neq("user_says", "correct")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      // Newest + oldest rows currently materialised in the MV.
      const { data: mvNewest, error: newErr } = await supabase
        .from("feedback_triage_queue")
        .select("feedback_created_at")
        .order("feedback_created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: mvOldest, error: oldErr } = await supabase
        .from("feedback_triage_queue")
        .select("feedback_created_at")
        .order("feedback_created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      // Fail SAFE: if any guard query errored we can't prove the MV is current,
      // so refresh rather than masquerade an error as a "no new feedback" skip.
      if (fbErr || newErr || oldErr) return true;

      // (a) A materialised row has aged past the 30-day window → REFRESH drops it.
      if (
        mvOldest?.feedback_created_at &&
        new Date(mvOldest.feedback_created_at).getTime() <= cutoffMs
      ) {
        return true;
      }
      // (b) No disagreement in the window → the MV should be empty; refresh only
      //     if it still holds rows (e.g. the last disagreement was archived).
      if (!latestFb?.created_at) return Boolean(mvNewest?.feedback_created_at);
      // (c) MV empty but a disagreement exists → populate it.
      if (!mvNewest?.feedback_created_at) return true;
      // (d) A newer disagreement exists than the MV holds → refresh to include it.
      return (
        new Date(latestFb.created_at).getTime() >
        new Date(mvNewest.feedback_created_at).getTime()
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
