import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import type { Platform } from "./types";

interface EnqueueOptions {
  platform: Platform;
  userId: string;
  text: string;
  images?: string[];
  replyTo?: Record<string, unknown>;
}

/**
 * Enqueue a bot message for async processing.
 * Falls back to direct processing if Supabase is not configured.
 */
export async function enqueueMessage(options: EnqueueOptions): Promise<boolean> {
  const supabase = createServiceClient();
  if (!supabase) {
    logger.warn("Queue: Supabase not configured, cannot enqueue");
    return false;
  }

  try {
    const { error } = await supabase.from("bot_message_queue").insert({
      platform: options.platform,
      user_id: options.userId,
      message_text: options.text,
      images: options.images ?? [],
      reply_to: options.replyTo ?? null,
      status: "pending",
    });

    if (error) {
      logger.error("Queue: failed to enqueue message", { error: error.message });
      return false;
    }

    return true;
  } catch (err) {
    logger.error("Queue: enqueue error", { error: String(err) });
    return false;
  }
}

export interface QueuedMessage {
  id: string;
  platform: Platform;
  user_id: string;
  message_text: string;
  images: string[];
  reply_to: Record<string, unknown> | null;
  retries: number;
  max_retries: number;
}

/**
 * Dequeue a batch of pending messages for processing.
 */
export async function dequeueBatch(batchSize: number = 5): Promise<QueuedMessage[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("bot_message_queue")
    .select("id, platform, user_id, message_text, images, reply_to, retries, max_retries")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    logger.error("Queue: dequeue error", { error: error.message });
    return [];
  }

  if (!data || data.length === 0) return [];

  // Mark as processing
  const ids = data.map((d) => d.id);
  await supabase
    .from("bot_message_queue")
    .update({ status: "processing", processed_at: new Date().toISOString() })
    .in("id", ids);

  return data as QueuedMessage[];
}

// On terminal state (completed/failed), clear raw user input so bot_message_queue
// stops persisting PII. The row is kept for audit (status, retries, timings,
// error_message) and is hard-deleted by the cleanup cron after 24h.
export async function markCompleted(id: string): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;

  await supabase
    .from("bot_message_queue")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      message_text: "",
      images: [],
      reply_to: null,
    })
    .eq("id", id);
}

/**
 * Mark a queued message as failed, incrementing retry count.
 * If retries exhausted, marks as permanently failed and clears PII.
 * If still retryable, keeps message_text/images intact for the next attempt.
 */
export async function markFailed(
  id: string,
  errorMessage: string,
  retries: number,
  maxRetries: number,
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;

  const exhausted = retries + 1 >= maxRetries;
  const newStatus = exhausted ? "failed" : "pending";

  const patch: Record<string, unknown> = {
    status: newStatus,
    retries: retries + 1,
    error_message: errorMessage,
  };
  if (exhausted) {
    patch.message_text = "";
    patch.images = [];
    patch.reply_to = null;
  }

  await supabase
    .from("bot_message_queue")
    .update(patch)
    .eq("id", id);
}
