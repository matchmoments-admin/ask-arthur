import { webhookCallback } from "grammy";
import { bot } from "@/lib/bots/telegram/bot";
import { verifyTelegramSecret } from "@askarthur/bot-core/webhook-verify";
import { logger } from "@askarthur/utils/logger";

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: Request) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return new Response("Telegram bot not configured", { status: 503 });
  }

  if (!verifyTelegramSecret(req)) {
    logger.warn("Telegram webhook: invalid secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    return await handleUpdate(req);
  } catch (err) {
    logger.error("Telegram webhook error", { error: String(err) });
    return new Response("Internal Server Error", { status: 500 });
  }
}
