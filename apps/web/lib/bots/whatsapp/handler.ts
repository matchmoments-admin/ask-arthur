import { Redis } from "@upstash/redis";
import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toWhatsAppMessage } from "@askarthur/bot-core/format-whatsapp";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { sendTextMessage, sendInteractiveButtons } from "./api";
import { downloadWhatsAppMedia } from "./media";

const DISCLOSURE_MESSAGE =
  "Welcome to Ask Arthur \u2014 Australia's scam detection service. " +
  "I use Anthropic's Claude AI to analyse messages for scam indicators. " +
  "Your messages are processed in real-time and never stored.\n\n" +
  "Forward me a suspicious message to check it.";

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

async function hashPhone(phone: string): Promise<string> {
  const data = new TextEncoder().encode(phone);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Check if this is a first-time user and send AI disclosure if so.
 * Returns true if this is a new user (disclosure was sent).
 */
async function sendDisclosureIfNew(from: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  const phoneHash = await hashPhone(from);
  const key = `whatsapp:seen:${phoneHash}`;
  const seen = await redis.get(key);
  if (seen) return false;

  // Mark as seen with 30-day TTL
  await redis.set(key, "1", { ex: 30 * 24 * 60 * 60 });
  await sendTextMessage(from, DISCLOSURE_MESSAGE);
  return true;
}

interface WhatsAppMessage {
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  interactive?: { button_reply?: { id: string } };
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
    }>;
  }>;
}

/**
 * Process an incoming WhatsApp webhook payload.
 */
export async function handleWhatsAppWebhook(payload: WhatsAppWebhookPayload): Promise<void> {
  const messages = payload.entry?.[0]?.changes?.[0]?.value?.messages;
  if (!messages || messages.length === 0) return;

  for (const message of messages) {
    try {
      await processMessage(message);
    } catch (err) {
      logger.error("WhatsApp message processing failed", {
        error: String(err),
        from: message.from,
      });
    }
  }
}

async function processMessage(message: WhatsAppMessage): Promise<void> {
  const { from } = message;

  // Handle button replies
  if (message.type === "interactive" && message.interactive?.button_reply) {
    const buttonId = message.interactive.button_reply.id;
    if (buttonId === "action:report") {
      await sendTextMessage(
        from,
        "Report this scam:\n\n" +
        "\u2022 Scamwatch: scamwatch.gov.au/report-a-scam\n" +
        "\u2022 ReportCyber: cyber.gov.au/report-and-recover/report\n" +
        "\u2022 Contact your bank immediately if you've shared financial details"
      );
    } else if (buttonId === "action:check") {
      await sendTextMessage(from, "Send me another message to check \u{1f50d}");
    } else if (buttonId === "action:about") {
      await sendTextMessage(from, DISCLOSURE_MESSAGE);
    }
    return;
  }

  // Send AI disclosure on first interaction
  await sendDisclosureIfNew(from);

  // Handle image messages
  if (message.type === "image" && message.image?.id) {
    await processImageMessage(from, message.image.id, message.image.caption);
    return;
  }

  // Only process text messages
  if (message.type !== "text" || !message.text?.body) {
    await sendTextMessage(
      from,
      "Send me a text message or image to check for scams.",
    );
    return;
  }

  const text = message.text.body;
  await processAnalysis(from, text);
}

async function processImageMessage(
  from: string,
  mediaId: string,
  caption?: string,
): Promise<void> {
  // Rate limit check
  const rateLimit = await checkBotRateLimit("whatsapp", from);
  if (!rateLimit.allowed) {
    await sendTextMessage(from, rateLimit.message ?? "Rate limit exceeded. Please try again later.");
    return;
  }

  try {
    const base64 = await downloadWhatsAppMedia(mediaId);
    if (!base64) {
      await sendTextMessage(
        from,
        "Sorry, I couldn't download that image. Please try sending it again, or paste the suspicious text instead.",
      );
      return;
    }

    const result = await analyzeForBot(caption ?? "Analyse this image for scam indicators", undefined, [base64]);
    const formatted = toWhatsAppMessage(result);

    const buttons: Array<{ id: string; title: string }> = [];
    if (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS") {
      buttons.push({ id: "action:report", title: "Report scam" });
    }
    buttons.push({ id: "action:check", title: "Check another" });
    buttons.push({ id: "action:about", title: "About" });

    await sendInteractiveButtons(from, formatted, buttons);
  } catch (err) {
    logger.error("WhatsApp image analysis failed", { error: String(err) });
    await sendTextMessage(from, "Sorry, I couldn't analyse that image right now. Please try again in a moment.");
  }
}

async function processAnalysis(from: string, text: string): Promise<void> {
  // Rate limit check
  const rateLimit = await checkBotRateLimit("whatsapp", from);
  if (!rateLimit.allowed) {
    await sendTextMessage(from, rateLimit.message ?? "Rate limit exceeded. Please try again later.");
    return;
  }

  try {
    const result = await analyzeForBot(text);
    const formatted = toWhatsAppMessage(result);

    // Send the analysis result with follow-up buttons
    const buttons: Array<{ id: string; title: string }> = [];
    if (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS") {
      buttons.push({ id: "action:report", title: "Report scam" });
    }
    buttons.push({ id: "action:check", title: "Check another" });
    buttons.push({ id: "action:about", title: "About" });

    await sendInteractiveButtons(from, formatted, buttons);
  } catch (err) {
    logger.error("WhatsApp analysis failed", { error: String(err) });
    await sendTextMessage(from, "Sorry, I couldn't analyse that message right now. Please try again in a moment.");
  }
}
