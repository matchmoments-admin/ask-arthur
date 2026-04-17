import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toTelegramHTML } from "@askarthur/bot-core/format-telegram";
import { toWhatsAppMessage } from "@askarthur/bot-core/format-whatsapp";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { toMessengerMessage } from "@askarthur/bot-core/format-messenger";
import type { QueuedMessage } from "@askarthur/bot-core/queue";

/**
 * Core processor shared by the database-webhook handler (event-driven) and
 * the sweeper cron (safety net for pg_net-dropped webhooks).
 *
 * Platform-specific senders are imported dynamically to avoid circular deps
 * with the bot webhook routes that live under /app/api/webhooks/.
 */
export async function processQueuedMessage(
  message: QueuedMessage,
): Promise<void> {
  const images = message.images.length > 0 ? message.images : undefined;
  const result = await analyzeForBot(message.message_text, undefined, images);

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
      if (message.reply_to && typeof message.reply_to.response_url === "string") {
        await postToUrl(message.reply_to.response_url, blocks);
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
