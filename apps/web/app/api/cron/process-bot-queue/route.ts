import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toTelegramHTML } from "@askarthur/bot-core/format-telegram";
import { toWhatsAppMessage } from "@askarthur/bot-core/format-whatsapp";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { toMessengerMessage } from "@askarthur/bot-core/format-messenger";
import {
  dequeueBatch,
  markCompleted,
  markFailed,
  type QueuedMessage,
} from "@askarthur/bot-core/queue";
import { logger } from "@askarthur/utils/logger";

/**
 * POST: Process queued bot messages.
 * Called by pg_cron every 30 seconds, or can be invoked manually.
 * Authenticated via CRON_SECRET.
 */
export async function POST(req: Request) {
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const messages = await dequeueBatch(5);

    if (messages.length === 0) {
      return Response.json({ processed: 0 });
    }

    let processed = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        await processQueuedMessage(message);
        await markCompleted(message.id);
        processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await markFailed(
          message.id,
          errorMsg,
          message.retries,
          message.max_retries,
        );
        failed++;
        logger.error("Queue: message processing failed", {
          id: message.id,
          platform: message.platform,
          error: errorMsg,
        });
      }
    }

    return Response.json({ processed, failed, total: messages.length });
  } catch (err) {
    logger.error("Queue: batch processing error", { error: String(err) });
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}

async function processQueuedMessage(message: QueuedMessage): Promise<void> {
  const images = message.images.length > 0 ? message.images : undefined;
  const result = await analyzeForBot(message.message_text, undefined, images);

  // Format and send response based on platform
  switch (message.platform) {
    case "telegram": {
      const html = toTelegramHTML(result);
      await sendTelegramReply(message.reply_to, html);
      break;
    }
    case "whatsapp": {
      const text = toWhatsAppMessage(result);
      await sendWhatsAppReply(message.user_id, text, result);
      break;
    }
    case "slack": {
      const blocks = toSlackBlocks(result);
      if (message.reply_to?.response_url) {
        await postToUrl(message.reply_to.response_url as string, blocks);
      }
      break;
    }
    case "messenger": {
      const text = toMessengerMessage(result);
      await sendMessengerReply(message.user_id, text);
      break;
    }
  }
}

// Platform-specific senders — import dynamically to avoid circular deps
async function sendTelegramReply(
  replyTo: Record<string, unknown> | null,
  html: string,
): Promise<void> {
  if (!replyTo?.chatId) return;
  const { bot } = await import("@/lib/bots/telegram/bot");
  await bot.api.sendMessage(Number(replyTo.chatId), html, {
    parse_mode: "HTML",
  });
}

async function sendWhatsAppReply(
  userId: string,
  text: string,
  result: { verdict: string },
): Promise<void> {
  const { sendInteractiveButtons } = await import("@/lib/bots/whatsapp/api");
  const buttons = [{ id: "action:check", title: "Check another" }];
  if (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS") {
    buttons.unshift({ id: "action:report", title: "Report scam" });
  }
  await sendInteractiveButtons(userId, text, buttons);
}

async function sendMessengerReply(
  userId: string,
  text: string,
): Promise<void> {
  const { sendTextMessage } = await import("@/lib/bots/messenger/api");
  await sendTextMessage(userId, text);
}

async function postToUrl(url: string, body: unknown): Promise<void> {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
