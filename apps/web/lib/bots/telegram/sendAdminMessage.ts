import { logger } from "@askarthur/utils/logger";

/**
 * Send an HTML-formatted Telegram DM to the admin chat ID.
 *
 * Requires TELEGRAM_ADMIN_CHAT_ID env var — obtain via @userinfobot on Telegram.
 * Kept separate from the user-bot handlers so admin notifications don't mix
 * with the user-facing scam-check conversations.
 *
 * Silently no-ops (with a warn log) if TELEGRAM_ADMIN_CHAT_ID is unset, so
 * local dev and misconfigured environments don't throw from cron routes.
 */
export async function sendAdminTelegramMessage(
  text: string,
  options: { parseMode?: "HTML" | "MarkdownV2" } = {},
): Promise<void> {
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn("TELEGRAM_ADMIN_CHAT_ID not set — skipping admin DM");
    return;
  }

  const { bot } = await import("@/lib/bots/telegram/bot");
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: options.parseMode ?? "HTML",
    });
  } catch (err) {
    logger.error("sendAdminTelegramMessage failed", { error: String(err) });
  }
}
