import { verifySlackSignature } from "@askarthur/bot-core/webhook-verify";
import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";

interface ShortcutPayload {
  type: string;
  callback_id: string;
  trigger_id: string;
  user: { id: string; name: string };
  message?: { text: string; ts: string };
  response_url: string;
}

/**
 * POST: Slack interactive payload handler for message shortcuts.
 * Slack sends url-encoded form body with a JSON "payload" field.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // Verify Slack signing secret
  if (!verifySlackSignature(req, rawBody)) {
    logger.warn("Slack shortcuts: invalid signature");
    return new Response("Unauthorized", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return new Response("Bad Request", { status: 400 });
  }

  let payload: ShortcutPayload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Only handle message shortcuts with our callback ID
  if (payload.type !== "message_action" || payload.callback_id !== "check_scam_message") {
    return new Response("OK", { status: 200 });
  }

  const messageText = payload.message?.text;
  if (!messageText?.trim()) {
    await postEphemeral(payload.response_url, "No text found in that message.");
    return new Response("OK", { status: 200 });
  }

  // Process in background — acknowledge immediately
  const processPromise = processShortcut(
    payload.user.id,
    messageText,
    payload.response_url,
  );
  processPromise.catch((err) =>
    logger.error("Slack shortcut processing failed", { error: String(err) }),
  );

  return new Response("OK", { status: 200 });
}

async function processShortcut(
  userId: string,
  text: string,
  responseUrl: string,
): Promise<void> {
  // Rate limit
  const rateLimit = await checkBotRateLimit("slack", userId);
  if (!rateLimit.allowed) {
    await postEphemeral(
      responseUrl,
      rateLimit.message ?? "Rate limit exceeded. Please try again later.",
    );
    return;
  }

  try {
    const result = await analyzeForBot(text);
    const slackResponse = toSlackBlocks(result);
    await postToResponseUrl(responseUrl, slackResponse);
  } catch (err) {
    logger.error("Slack shortcut analysis failed", { error: String(err) });
    await postEphemeral(
      responseUrl,
      "Sorry, I couldn't analyse that message right now. Please try again in a moment.",
    );
  }
}

async function postEphemeral(url: string, text: string): Promise<void> {
  await postToResponseUrl(url, { response_type: "ephemeral", text });
}

async function postToResponseUrl(url: string, body: unknown): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      logger.error("Slack response_url POST failed", { status: response.status });
    }
  } catch (err) {
    logger.error("Slack response_url POST error", { error: String(err) });
  }
}
