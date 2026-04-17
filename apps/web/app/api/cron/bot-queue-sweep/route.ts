import { NextResponse } from "next/server";
import { createServiceClient } from "@askarthur/supabase/server";
import { markCompleted, markFailed, type QueuedMessage } from "@askarthur/bot-core/queue";
import { logger } from "@askarthur/utils/logger";
import { processQueuedMessage } from "@/lib/bot-message-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Safety-net sweeper for the bot_message_queue.
 *
 * The primary processing path is event-driven via Supabase Database Webhook
 * → /api/bot-webhook. But pg_net doesn't retry, so if the webhook fires
 * and the HTTP call fails (cold start, 5xx, network blip) the row stays
 * in 'pending' forever.
 *
 * This sweeper runs every 10 minutes (vercel.json) and picks up any row
 * that has been pending for > 2 minutes. Bounded batch (max 20) so a
 * backlog can't consume the 60s Vercel budget.
 *
 * Authenticated via CRON_SECRET (Vercel auto-attaches this header to
 * scheduled invocations; see Vercel docs).
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Stale threshold: 2 minutes. Anything still pending after that window
  // either had its webhook dropped by pg_net, or the webhook handler 500'd.
  const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

  const { data: stale, error: selectError } = await supabase
    .from("bot_message_queue")
    .select("id, platform, user_id, message_text, images, reply_to, retries, max_retries")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(20);

  if (selectError) {
    logger.error("bot-queue-sweep: select error", { error: selectError.message });
    return NextResponse.json({ error: "select_failed" }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ swept: 0, failed: 0 });
  }

  let swept = 0;
  let failed = 0;

  for (const row of stale as QueuedMessage[]) {
    // Atomic claim, same pattern as the webhook handler.
    const { data: claimed } = await supabase
      .from("bot_message_queue")
      .update({ status: "processing", processed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (!claimed) continue; // raced with a concurrent webhook, skip.

    try {
      await processQueuedMessage(row);
      await markCompleted(row.id);
      swept++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await markFailed(row.id, errorMsg, row.retries, row.max_retries);
      failed++;
      logger.error("bot-queue-sweep: processing failed", {
        id: row.id,
        platform: row.platform,
        error: errorMsg,
      });
    }
  }

  return NextResponse.json({ swept, failed, total: stale.length });
}
