import { logger } from "@askarthur/utils/logger";

const GRAPH_API_VERSION = "v22.0";

export interface MessengerQuickReply {
  title: string;
  payload: string;
}

/**
 * Low-level POST to the Messenger Send API. Both message sends and sender
 * actions (typing indicator) go through here so the token/URL/error handling
 * lives in one place.
 */
async function postSendApi(payload: Record<string, unknown>): Promise<void> {
  const accessToken = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    logger.error("Messenger API not configured: missing MESSENGER_PAGE_ACCESS_TOKEN");
    return;
  }

  // Token goes in the Authorization header (not the query string) so it can't
  // leak via upstream proxy / access logs — matches the WhatsApp send path.
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    logger.error("Messenger API error", { status: response.status, body });
  }
}

/**
 * Send a message. Replies are tagged `messaging_type: "RESPONSE"` since the bot
 * only ever responds to a user-initiated message (always inside Meta's 24-hour
 * messaging window).
 */
async function callSendApi(
  recipientId: string,
  message: Record<string, unknown>,
): Promise<void> {
  await postSendApi({
    recipient: { id: recipientId },
    messaging_type: "RESPONSE",
    message,
  });
}

/**
 * Show the "typing…" indicator while an analysis runs (~1-8s of Claude
 * vision/text latency). A sender action carries no `message`/`messaging_type` —
 * Meta rejects those together. Best-effort: a failure just means no indicator.
 */
export async function sendTypingOn(recipientId: string): Promise<void> {
  await postSendApi({
    recipient: { id: recipientId },
    sender_action: "typing_on",
  });
}

/**
 * Send a plain text message to a Messenger user.
 */
export async function sendTextMessage(
  recipientId: string,
  text: string,
): Promise<void> {
  await callSendApi(recipientId, { text });
}

/**
 * Send a text message with quick-reply buttons. Meta allows up to 13
 * quick replies; titles are capped at 20 characters. Taps come back on
 * the next inbound webhook as `message.quick_reply.payload`.
 */
export async function sendQuickReplies(
  recipientId: string,
  text: string,
  replies: MessengerQuickReply[],
): Promise<void> {
  await callSendApi(recipientId, {
    text,
    quick_replies: replies.slice(0, 13).map((r) => ({
      content_type: "text",
      title: r.title.slice(0, 20),
      payload: r.payload,
    })),
  });
}
