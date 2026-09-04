import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { inngest } from "@askarthur/scam-engine/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Reddit Intelligence — trigger cron.
//
// Schedule (vercel.json): 0 1,7,13,19 * * * — one hour after each tier-6h
// scrape (0 */6 * * *, .github/workflows/scrape-feeds.yml:36).
//
// Why 6-hourly, reversing the earlier daily decision.
//
// A first version of this comment argued the reversal was cost-neutral because
// the system block is sent with cache_control: ephemeral. That was WRONG and a
// review caught it: anthropic.ts:262 sends ephemeral with no `ttl`, which is
// the 5-minute default, so runs six hours apart ALWAYS miss the cache — and a
// cache write is billed at 1.25x input. Four runs a day means four cache
// writes instead of one, which is exactly the 4x the original daily decision
// predicted.
//
// The honest accounting: the system prompt is ~2K tokens, so the extra three
// writes cost roughly 2,000 x 1.25 x $3/M x 3 = about US$0.02 a day. Real, and
// far too small to outweigh what daily was costing us — up to 24 hours of
// staleness on the items at the TOP of the public feed, the ones a reader
// actually sees, and a drain rate of 40/day against ~37/day of arrivals, so a
// single missed run never recovered. The per-post tokens, which dominate the
// bill, are identical either way. Four smaller batches also sit better with
// the 5-slot Inngest plan than one long one.
//
// So: the change is justified on freshness and backlog, and costs about two
// cents a day. It is not free, and the earlier claim that it was is struck.
//
// Timing dependency: GitHub Actions runs the Reddit scrape at 06:00 UTC.
// Each tick fires one hour after a scrape (scrape at 00/06/12/18, this at
// 01/07/13/19), which gives the scrape an hour to complete and
// land rows in feed_items before we try to classify them.
//
// Polls feed_items for Reddit rows that don't yet have a
// reddit_post_intel row, batches up to BATCH_SIZE, and emits
// reddit.intel.batch_ready.v1 — which the Inngest function
// reddit-intel-daily.ts consumes.
//
// Why polling instead of event-on-write: pipeline/scrapers/reddit_scams.py
// is Python and writes to feed_items via psycopg directly. Wiring an
// Inngest client into the Python scraper would mean adding the JS Inngest
// HTTP API as a Python dependency just to fire one event. A cron that
// polls feed_items is simpler, idempotent (the consumer dedups against
// reddit_post_intel.feed_item_id UNIQUE), and survives scraper restarts
// without coordination.
//
// Auth: Bearer CRON_SECRET, same shape as every other /api/cron/* route.
// Gate: featureFlags.redditIntelIngest. When OFF the cron returns
// `skipped: true` without querying — cheap and safe.

// Sized for the daily Sonnet 4.6 call: at ~150 output tokens per post + a
// 200-300 word daily summary (~600 tokens), 40 posts produces ~7k output
// tokens which Sonnet 4.6 streams in ~90-120s. Combined with the 240s SDK
// timeout in reddit-intel-daily.ts that leaves ~50% headroom for slow
// Sonnet days and the ~30s of input upload + JSON parse overhead. Going
// higher risks SDK-timeout / output-truncation cascades that burn tokens
// on retries with no successful outcome.
//
// At ~38 posts/day actual Reddit volume, one cron tick per day is the
// steady state — but note the drain rate is 40/day against ~37/day of
// arrivals, so a missed day never fully recovers and anything that falls
// out of CANDIDATE_WINDOW is unreachable. The original BATCH_SIZE=200 looked
// reasonable on paper but caused the first prod fire to time out — see
// the v82-followup PR description for the post-mortem.
const BATCH_SIZE = 40;
const CANDIDATE_WINDOW = 1_000; // Candidates examined per run before NOT-IN filter.

export async function GET(req: Request) {
  const unauthorized = requireCronAuth(req);
  if (unauthorized) return unauthorized;

  if (!featureFlags.redditIntelIngest) {
    return NextResponse.json({ skipped: true, reason: "flag_off" });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  try {
    // 1. Pull recent Reddit candidates. Ordering newest-first means a backlog
    //    is processed in chronological-reverse, which is fine — the daily
    //    summary key is cohort_date so each batch lands in the right bucket.
    const { data: candidates, error: candErr } = await supabase
      .from("feed_items")
      .select("id")
      .eq("source", "reddit")
      .order("source_created_at", { ascending: false })
      .limit(CANDIDATE_WINDOW);

    if (candErr) {
      throw new Error(`candidate query: ${candErr.message}`);
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json({ ok: true, candidates: 0, dispatched: 0 });
    }

    const candidateIds = candidates.map((r) => r.id as number);

    // 2. Find which of those already have an intel row. supabase-js doesn't
    //    support sub-queries directly, so this is the cheapest two-query
    //    anti-join: ≤1000 ids in, ≤1000 ids out.
    const { data: classified, error: classErr } = await supabase
      .from("reddit_post_intel")
      .select("feed_item_id")
      .in("feed_item_id", candidateIds);

    if (classErr) {
      throw new Error(`classified query: ${classErr.message}`);
    }

    const classifiedSet = new Set(
      (classified ?? []).map((r) => r.feed_item_id as number),
    );

    const unprocessed = candidateIds.filter((id) => !classifiedSet.has(id));

    if (unprocessed.length === 0) {
      return NextResponse.json({
        ok: true,
        candidates: candidateIds.length,
        dispatched: 0,
        reason: "all_classified",
      });
    }

    // 3. Take the top BATCH_SIZE (newest) and emit. If there are more, the
    //    next run picks them up — at ~38 posts/day against a 40/run drain
    //    the queue is usually clean, but a backlog is reported below and
    //    never prioritised (oldest rows age out of CANDIDATE_WINDOW).
    const batch = unprocessed.slice(0, BATCH_SIZE);

    await inngest.send({
      name: "reddit.intel.batch_ready.v1",
      data: {
        feedItemIds: batch,
        triggeredAt: new Date().toISOString(),
      },
    });

    logger.info("reddit-intel-trigger dispatched", {
      candidates: candidateIds.length,
      classifiedAlready: classifiedSet.size,
      dispatched: batch.length,
      backlog: unprocessed.length - batch.length,
    });

    return NextResponse.json({
      ok: true,
      candidates: candidateIds.length,
      classifiedAlready: classifiedSet.size,
      dispatched: batch.length,
      backlog: unprocessed.length - batch.length,
    });
  } catch (err) {
    logger.error("reddit-intel-trigger failed", { error: String(err) });
    return NextResponse.json(
      { error: "trigger_failed", message: String(err) },
      { status: 500 },
    );
  }
}
