import { webhookCallback } from "grammy";
import { bot } from "@/lib/bots/telegram/bot";
import { verifyTelegramSecret } from "@askarthur/bot-core/webhook-verify";
import { logger } from "@askarthur/utils/logger";
import { isReplay } from "@/lib/bots/replay-dedup";

// node:crypto (via bot-core verifier) is unavailable on Edge; pin Node + dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: Request) {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return new Response("Telegram bot not configured", { status: 503 });
  }

  if (!verifyTelegramSecret(req)) {
    logger.warn("Telegram webhook: invalid secret token");
    return new Response("Unauthorized", { status: 401 });
  }

  // Suppress retries/replays of an already-handled update. Telegram re-sends the
  // same update_id on any slow/non-2xx response. Read it from a CLONE so the
  // original body stream stays intact for grammy's webhookCallback below.
  try {
    const peeked = (await req.clone().json()) as { update_id?: number };
    if (peeked?.update_id != null && (await isReplay("telegram", peeked.update_id))) {
      return new Response("OK", { status: 200 });
    }
  } catch {
    // Unparseable body — let grammy handle (and reject) it below.
  }

  try {
    return await handleUpdate(req);
  } catch (err) {
    logger.error("Telegram webhook error", { error: String(err) });
    return new Response("Internal Server Error", { status: 500 });
  }
}
