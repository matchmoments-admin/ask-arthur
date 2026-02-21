import { logger } from "@askarthur/utils/logger";

const GRAPH_API_VERSION = "v22.0";

function getConfig() {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return { accessToken, phoneNumberId };
}

async function sendMessage(to: string, payload: Record<string, unknown>): Promise<void> {
  const { accessToken, phoneNumberId } = getConfig();
  if (!accessToken || !phoneNumberId) {
    logger.error("WhatsApp API not configured");
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      ...payload,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("WhatsApp API error", { status: response.status, body });
  }
}

/**
 * Send a plain text message.
 */
export async function sendTextMessage(to: string, text: string): Promise<void> {
  await sendMessage(to, {
    type: "text",
    text: { body: text },
  });
}

/**
 * Send an interactive button message (max 3 buttons).
 */
export async function sendInteractiveButtons(
  to: string,
  body: string,
  buttons: Array<{ id: string; title: string }>
): Promise<void> {
  await sendMessage(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: "reply",
          reply: { id: btn.id, title: btn.title },
        })),
      },
    },
  });
}
