/**
 * Telegram bot dev script — runs in long-polling mode.
 * Usage: pnpm --filter @askarthur/web telegram:dev
 *
 * Requires TELEGRAM_BOT_TOKEN in .env.local
 */

import "dotenv/config";
import { bot } from "../lib/bots/telegram/bot";

bot.start({
  onStart: (botInfo) => {
    console.log(`Telegram bot @${botInfo.username} running (long-polling mode)`);
    console.log("Send /start to the bot to test");
  },
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
