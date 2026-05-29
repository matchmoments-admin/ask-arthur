// Nightly retention for the reddit_processed_posts dedup tracker.
//
// reddit_processed_posts is the per-scraper-run dedup gate (one row per
// (subreddit, reddit_post_id) inserted on first sighting; subsequent runs
// skip rows already in the table). It grows unbounded across daily polls
// and is not read by the web app. The cleanup_old_reddit_posts(p_days)
// RPC (defined in pipeline/scrapers/common/db.py:735+ and registered as a
// SECURITY DEFINER function) DELETEs rows older than p_days.
//
// 30-day window matches the dedup horizon — Reddit posts older than that
// are no longer being re-encountered by the daily scraper, so the dedup
// signal has fully amortised.
//
// Schedule: 03:45 UTC nightly (13:45 AEST). After phone-footprint-retention
// (03:15) and feed-retention (02:30); minimal lock contention.
//
// Plan reference: phase 2.4 of the data-model improvement plan.
// BACKLOG-flagged in "Phase 1 commercial readiness" → reddit_processed_posts.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";

const RETENTION_DAYS = 30;

export const redditProcessedPostsRetention = inngest.createFunction(
  {
    id: "reddit-processed-posts-retention",
    timeouts: { finish: "4m" },
    name: "Reddit Intel: Prune reddit_processed_posts dedup tracker",
    retries: 2,
  },
  { cron: "45 3 * * *" },
  async ({ step }) => {
    const deleted = await step.run("cleanup-old-reddit-posts", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("cleanup_old_reddit_posts", {
        p_days: RETENTION_DAYS,
      });
      if (error) throw new Error(`cleanup_old_reddit_posts failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    logger.info("reddit-processed-posts-retention: complete", {
      deletedRows: deleted,
      retentionDays: RETENTION_DAYS,
    });

    return { deletedRows: deleted, retentionDays: RETENTION_DAYS };
  },
);
