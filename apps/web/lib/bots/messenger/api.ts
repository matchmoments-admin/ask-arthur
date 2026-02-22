import { logger } from "@askarthur/utils/logger";

const GRAPH_API_VERSION = "v22.0";

/**
 * Send a text message to a Messenger user via the Send API.
 */
export async function sendTextMessage(
  recipientId: string,
  text: string,
): Promise<void> {
  const accessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    logger.error("Messenger API not configured: missing MESSENGER_PAGE_ACCESS_TOKEN");
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${accessToken}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("Messenger API error", { status: response.status, body });
  }
}
