import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@askarthur/supabase/server";
import { markCompleted, markFailed, type QueuedMessage } from "@askarthur/bot-core/queue";
import { logger } from "@askarthur/utils/logger";
import { processQueuedMessage } from "@/lib/bot-message-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Supabase Database Webhook receiver for `bot_message_queue` INSERT events.
 *
 * Event-driven replacement for the 30s polling cron. Fires on each row
 * insert via pg_net, which does NOT retry — any delivery failures are
 * caught by the /api/cron/bot-queue-sweep safety-net cron (every 10 min).
 *
 * One-time dashboard setup (per environment):
 *   1. Generate a secret: `openssl rand -hex 32`
 *   2. Set SUPABASE_WEBHOOK_SECRET in Vercel env + Supabase Vault
 *   3. Supabase dashboard → Database → Webhooks → Create a new hook:
 *        name:    bot_message_queue_insert
 *        table:   public.bot_message_queue
 *        events:  INSERT
 *        type:    HTTP Request
 *        method:  POST
 *        URL:     https://askarthur.au/api/bot-webhook
 *        headers: X-Webhook-Secret: <SUPABASE_WEBHOOK_SECRET>
 *   4. Leave timeout at default (1000ms); Supabase auto-generates the
 *      underlying `supabase_functions.http_request` trigger via pg_net.
 */

type InsertPayload = {
  type: "INSERT";
  table: string;
  schema: string;
  record: {
    id: string;
    platform: "telegram" | "whatsapp" | "slack" | "messenger";
    user_id: string;
    message_text: string;
    images: string[];
    reply_to: Record<string, unknown> | null;
    status: string;
    retries: number;
    max_retries: number;
    created_at: string;
  };
  old_record: null;
};

function safeEqual(presented: string, expected: string): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const expected = process.env.SUPABASE_WEBHOOK_SECRET ?? "";
  if (!expected) {
    logger.error("bot-webhook: SUPABASE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const presented = req.headers.get("x-webhook-secret") ?? "";
  if (!safeEqual(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: InsertPayload;
  try {
    payload = (await req.json()) as InsertPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "bot_message_queue") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    logger.error("bot-webhook: Supabase client unavailable");
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  // Atomic claim: only process if status is still 'pending'. If the sweeper
  // grabbed it first (or another webhook replay), the UPDATE affects 0 rows
  // and we no-op — preventing double-processing.
  const { data: claimed, error: claimError } = await supabase
    .from("bot_message_queue")
    .update({ status: "processing", processed_at: new Date().toISOString() })
    .eq("id", payload.record.id)
    .eq("status", "pending")
    .select("id, platform, user_id, message_text, images, reply_to, retries, max_retries")
    .single();

  if (claimError || !claimed) {
    // Already processed by sweeper or duplicate webhook fire — fine.
    return NextResponse.json({ ok: true, already_claimed: true });
  }

  const message = claimed as QueuedMessage;

  try {
    await processQueuedMessage(message);
    await markCompleted(message.id);
    return NextResponse.json({ ok: true, id: message.id });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await markFailed(message.id, errorMsg, message.retries, message.max_retries);
    logger.error("bot-webhook: processing failed", {
      id: message.id,
      platform: message.platform,
      error: errorMsg,
    });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
