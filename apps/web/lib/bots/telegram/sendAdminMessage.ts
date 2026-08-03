import { logger } from "@askarthur/utils/logger";

/**
 * Outcome of an admin-DM attempt.
 *
 * This function used to return `Promise<void>` and swallow every failure into
 * `logger.error`, which is console-only. Combined with ~1-day Vercel log
 * retention and no cron route emitting to Axiom, that made "did the alert
 * actually arrive?" unanswerable across ~35 call sites — the root cause behind
 * several multi-week silent outages (see migration-v263 header).
 *
 * Callers that are alerters should pass this to `recordAlertDelivery()` rather
 * than ignoring it. The return value is intentionally NOT a thrown error:
 * a failed alert must never break the cron route that was trying to warn you.
 */
export type AdminMessageResult = {
  ok: boolean;
  /** Why it didn't send. 'no_config' | 'send_failed'. Absent on success. */
  reason?: "no_config" | "send_failed";
  error?: string;
  latencyMs: number;
};

/**
 * Send an HTML-formatted Telegram DM to the admin chat ID.
 *
 * Requires TELEGRAM_ADMIN_CHAT_ID env var — obtain via @userinfobot on Telegram.
 * Kept separate from the user-bot handlers so admin notifications don't mix
 * with the user-facing scam-check conversations.
 *
 * Never throws. Returns `{ok: false}` if TELEGRAM_ADMIN_CHAT_ID is unset or the
 * transport rejects, so local dev and misconfigured environments don't break
 * cron routes — but the caller can now tell, which it previously could not.
 */
export async function sendAdminTelegramMessage(
  text: string,
  options: { parseMode?: "HTML" | "MarkdownV2" } = {},
): Promise<AdminMessageResult> {
  const startedAt = Date.now();

  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!chatId) {
    logger.warn("TELEGRAM_ADMIN_CHAT_ID not set — skipping admin DM");
    return { ok: false, reason: "no_config", latencyMs: Date.now() - startedAt };
  }

  const { bot } = await import("@/lib/bots/telegram/bot");
  try {
    await bot.api.sendMessage(chatId, text, {
      parse_mode: options.parseMode ?? "HTML",
    });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    logger.error("sendAdminTelegramMessage failed", { error: String(err) });
    return {
      ok: false,
      reason: "send_failed",
      error: String(err),
      latencyMs: Date.now() - startedAt,
    };
  }
}
