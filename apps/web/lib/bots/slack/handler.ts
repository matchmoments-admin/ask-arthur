import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";

interface SlackSlashPayload {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  response_url: string;
  team_id: string;
  channel_id: string;
}

/**
 * Parse Slack slash command form-encoded body.
 */
export function parseSlashCommand(body: string): SlackSlashPayload {
  const params = new URLSearchParams(body);
  return {
    command: params.get("command") ?? "",
    text: params.get("text") ?? "",
    user_id: params.get("user_id") ?? "",
    user_name: params.get("user_name") ?? "",
    response_url: params.get("response_url") ?? "",
    team_id: params.get("team_id") ?? "",
    channel_id: params.get("channel_id") ?? "",
  };
}

/**
 * Process slash command and POST result to response_url.
 */
export async function handleSlashCommand(payload: SlackSlashPayload): Promise<void> {
  const { text, user_id, response_url } = payload;

  if (!text.trim()) {
    await postToResponseUrl(response_url, {
      response_type: "ephemeral",
      text: "Usage: `/checkscam <paste the suspicious message here>`",
    });
    return;
  }

  // Rate limit check
  const rateLimit = await checkBotRateLimit("slack", user_id);
  if (!rateLimit.allowed) {
    await postToResponseUrl(response_url, {
      response_type: "ephemeral",
      text: rateLimit.message ?? "Rate limit exceeded. Please try again later.",
    });
    return;
  }

  try {
    const result = await analyzeForBot(text);
    const slackResponse = toSlackBlocks(result);

    await postToResponseUrl(response_url, slackResponse);
  } catch (err) {
    logger.error("Slack analysis failed", { error: String(err) });
    await postToResponseUrl(response_url, {
      response_type: "ephemeral",
      text: "Sorry, I couldn't analyse that message right now. Please try again in a moment.",
    });
  }
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
