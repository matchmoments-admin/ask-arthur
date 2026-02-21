import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toWhatsAppMessage } from "@askarthur/bot-core/format-whatsapp";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { sendTextMessage, sendInteractiveButtons } from "./api";

interface WhatsAppMessage {
  from: string;
  type: string;
  text?: { body: string };
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
    }
    return;
  }

  // Only process text messages
  if (message.type !== "text" || !message.text?.body) {
    await sendTextMessage(from, "Please send me a text message to check for scams. I can't process images or other media yet.");
    return;
  }

  const text = message.text.body;

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
    const buttons = [
      { id: "action:check", title: "Check another" },
    ];

    if (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS") {
      buttons.unshift({ id: "action:report", title: "Report scam" });
    }

    await sendInteractiveButtons(from, formatted, buttons);
  } catch (err) {
    logger.error("WhatsApp analysis failed", { error: String(err) });
    await sendTextMessage(from, "Sorry, I couldn't analyse that message right now. Please try again in a moment.");
  }
}
