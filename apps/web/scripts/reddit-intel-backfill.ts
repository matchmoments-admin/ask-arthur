/**
 * Reddit Intelligence — backfill script.
 * Usage: pnpm --filter @askarthur/web tsx scripts/reddit-intel-backfill.ts [days]
 *
 * Pages through Reddit feed_items from the last N days (default 30) that
 * don't yet have a reddit_post_intel row, batches up to 200 at a time, and
 * fires reddit.intel.batch_ready.v1 for each batch. Sleeps 30s between
 * batches so the Inngest function processes them sequentially without
 * overlapping Sonnet calls — at one batch per ~5 min, a 30-day backfill
 * (~1140 posts) completes in ~30 min and costs ~$3 on Sonnet 4.6.
 *
 * Idempotent: the trigger event consumer dedups against
 * reddit_post_intel.feed_item_id UNIQUE. Safe to re-run; previously-
 * classified rows are silently skipped.
 *
 * Requires:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL +
 *     SUPABASE_SERVICE_ROLE_KEY) in .env.local — for the candidate query.
 *   - INNGEST_EVENT_KEY in .env.local — for sending events to prod Inngest.
 */

import "dotenv/config";

import { createServiceClient } from "@askarthur/supabase/server";
import { inngest } from "@askarthur/scam-engine/inngest/client";

// Matches the cron route's BATCH_SIZE — see route.ts for sizing rationale.
const BATCH_SIZE = 40;
// 240s SDK timeout in the consumer + ~30s slack = wait at least 5 min
// between batches so consecutive Sonnet calls don't queue behind each other.
const SLEEP_MS = 300_000;

async function main() {
  const days = Number(process.argv[2] ?? 30);
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    console.error(`Invalid days arg: ${process.argv[2]}. Use 1-365.`);
    process.exit(1);
  }

  const supabase = createServiceClient();
  if (!supabase) {
    console.error(
      "Supabase service client unavailable. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  console.log(`[backfill] window: ${cutoff} → now (last ${days} days)`);

  // Pull candidate IDs newest-first. Pages of 1000 to keep the response
  // small — we'll batch these into 200-id event payloads.
  const { data: candidates, error: candErr } = await supabase
    .from("feed_items")
    .select("id, source_created_at")
    .eq("source", "reddit")
    .gte("source_created_at", cutoff)
    .order("source_created_at", { ascending: false })
    .limit(5_000); // 5k = ~130 days at 38 posts/day, generous safety margin

  if (candErr) {
    console.error(`[backfill] candidate query failed: ${candErr.message}`);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log("[backfill] no candidates in window. Done.");
    return;
  }

  const candidateIds = candidates.map((r) => r.id as number);
  console.log(`[backfill] fetched ${candidateIds.length} candidate posts`);

  // Filter out already-classified.
  const { data: classified, error: classErr } = await supabase
    .from("reddit_post_intel")
    .select("feed_item_id")
    .in("feed_item_id", candidateIds);

  if (classErr) {
    console.error(`[backfill] classified query failed: ${classErr.message}`);
    process.exit(1);
  }

  const classifiedSet = new Set(
    (classified ?? []).map((r) => r.feed_item_id as number),
  );
  const unprocessed = candidateIds.filter((id) => !classifiedSet.has(id));

  console.log(
    `[backfill] ${classifiedSet.size} already classified; ${unprocessed.length} to dispatch`,
  );

  if (unprocessed.length === 0) {
    console.log("[backfill] nothing to do. Done.");
    return;
  }

  // Dispatch in batches.
  let dispatched = 0;
  const totalBatches = Math.ceil(unprocessed.length / BATCH_SIZE);
  for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
    const batch = unprocessed.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    console.log(
      `[backfill] dispatching batch ${batchNum}/${totalBatches} (${batch.length} posts)`,
    );

    await inngest.send({
      name: "reddit.intel.batch_ready.v1",
      data: {
        feedItemIds: batch,
        triggeredAt: new Date().toISOString(),
      },
    });

    dispatched += batch.length;

    if (i + BATCH_SIZE < unprocessed.length) {
      console.log(`[backfill] sleeping ${SLEEP_MS / 1000}s before next batch...`);
      await new Promise((r) => setTimeout(r, SLEEP_MS));
    }
  }

  console.log(
    `[backfill] done. Dispatched ${dispatched} posts across ${totalBatches} batches.`,
  );
  console.log(
    "[backfill] Watch Inngest dashboard for processing progress and any retries.",
  );
}

main().catch((err) => {
  console.error("[backfill] fatal:", err);
  process.exit(1);
});
