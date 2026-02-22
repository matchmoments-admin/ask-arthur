import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toMessengerMessage } from "@askarthur/bot-core/format-messenger";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { sendTextMessage } from "./api";

interface MessengerWebhookPayload {
  object?: string;
  entry?: Array<{
    messaging?: Array<{
      sender?: { id: string };
      message?: { text?: string; mid?: string };
    }>;
  }>;
}

/**
 * Process an incoming Messenger webhook payload.
 */
export async function handleMessengerWebhook(
  payload: MessengerWebhookPayload,
): Promise<void> {
  if (payload.object !== "page") return;

  const messaging = payload.entry?.[0]?.messaging;
  if (!messaging || messaging.length === 0) return;

  for (const event of messaging) {
    if (!event.sender?.id || !event.message?.text) continue;

    try {
      await processMessage(event.sender.id, event.message.text);
    } catch (err) {
      logger.error("Messenger message processing failed", {
        error: String(err),
        senderId: event.sender.id,
      });
    }
  }
}

async function processMessage(
  senderId: string,
  text: string,
): Promise<void> {
  // Rate limit check
  const rateLimit = await checkBotRateLimit("messenger", senderId);
  if (!rateLimit.allowed) {
    await sendTextMessage(
      senderId,
      rateLimit.message ?? "Rate limit exceeded. Please try again later.",
    );
    return;
  }

  if (!text.trim()) {
    await sendTextMessage(
      senderId,
      "Send me a suspicious message and I'll check it for scam indicators.",
    );
    return;
  }

  try {
    const result = await analyzeForBot(text);
    const formatted = toMessengerMessage(result);

    // Messenger has a 2000 char limit per message
    if (formatted.length > 2000) {
      // Split into multiple messages
      const chunks = splitMessage(formatted, 2000);
      for (const chunk of chunks) {
        await sendTextMessage(senderId, chunk);
      }
    } else {
      await sendTextMessage(senderId, formatted);
    }
  } catch (err) {
    logger.error("Messenger analysis failed", { error: String(err) });
    await sendTextMessage(
      senderId,
      "Sorry, I couldn't analyse that message right now. Please try again in a moment.",
    );
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}
