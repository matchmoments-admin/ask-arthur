// Nightly retention housekeeping for the news-intel feed surfaces.
//
// Runs three RPCs (all idempotent, all bounded):
//   1. archive_feed_items_batch — loops until returned moved_items = 0
//      so a single tick fully drains anything that aged out today.
//   2. prune_feed_ingestion_log — 90-day rolling window for monitoring rows.
//   3. prune_feed_http_cache    — 30-day rolling window for ETag entries.
//
// Why one combined Inngest function: all three are sub-second on our volume,
// share a Supabase client, and only fire once a day. Splitting them would
// triple the Inngest function-count without any operational benefit.
//
// Schedule: 02:30 UTC nightly (= 12:30 AEST). Off-peak for both AU + US,
// well clear of the 02:00 UTC daily scraper tier (16:00 UTC, 02:00 AEST).

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

import { inngest } from "./client";

const ARCHIVE_BATCH_SIZE = 5000;
const ARCHIVE_DEFAULT_DAYS = 365;
const LOG_RETENTION_DAYS = 90;
const CACHE_RETENTION_DAYS = 30;
const ARCHIVE_LOOP_GUARD = 50; // hard cap on loop iterations

export const feedRetention = inngest.createFunction(
  {
    id: "feed-retention",
    timeouts: { finish: "4m" },
    name: "News Intel: Nightly retention housekeeping",
    retries: 2,
  },
  { cron: "30 2 * * *" },
  async ({ step }) => {
    // ── archive narrative feed_items rows older than 365 days ─────────────
    const archived = await step.run("archive-feed-items", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      let total = 0;
      for (let i = 0; i < ARCHIVE_LOOP_GUARD; i++) {
        const { data, error } = await supabase.rpc("archive_feed_items_batch", {
          p_batch_size: ARCHIVE_BATCH_SIZE,
          p_default_days: ARCHIVE_DEFAULT_DAYS,
        });
        if (error) throw new Error(`archive_feed_items_batch failed: ${error.message}`);
        const moved = (data?.[0]?.moved_items as number) ?? 0;
        total += moved;
        if (moved === 0) break;
      }
      return total;
    });

    // ── prune feed_ingestion_log > 90d ────────────────────────────────────
    const prunedLog = await step.run("prune-ingestion-log", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("prune_feed_ingestion_log", {
        p_days: LOG_RETENTION_DAYS,
      });
      if (error) throw new Error(`prune_feed_ingestion_log failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    // ── prune feed_http_cache > 30d ───────────────────────────────────────
    const prunedCache = await step.run("prune-http-cache", async () => {
      const supabase = createServiceClient();
      if (!supabase) throw new Error("supabase service client unavailable");
      const { data, error } = await supabase.rpc("prune_feed_http_cache", {
        p_days: CACHE_RETENTION_DAYS,
      });
      if (error) throw new Error(`prune_feed_http_cache failed: ${error.message}`);
      return (data as number) ?? 0;
    });

    logger.info("feed-retention: complete", {
      archivedNarratives: archived,
      prunedLogRows: prunedLog,
      prunedCacheRows: prunedCache,
    });

    return {
      archivedNarratives: archived,
      prunedLogRows: prunedLog,
      prunedCacheRows: prunedCache,
    };
  },
);
