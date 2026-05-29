import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { assertSafeURL } from "@askarthur/scam-engine/ssrf-guard";
import { logger } from "@askarthur/utils/logger";

// Slack's slash-command webhook hands us a `response_url` we POST the
// verdict back to. The token only authorises Slack as the producer of
// the payload, not the URL — so without a hostname check the route is a
// confused-deputy SSRF: a forged `response_url` could point at internal
// infra and our server would oblige. Slack always uses hooks.slack.com
// for response_urls (separate from incoming webhooks at
// hooks.slack.com/services/...), so the allowlist is a single host.
const SLACK_RESPONSE_HOST = "hooks.slack.com";

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
    const result = await analyzeForBot(text, undefined, undefined, {
      source: "bot_slack",
      userId: user_id,
      inputMode: "text",
    });
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
  // Two-layer SSRF defence:
  //   1. Hostname allowlist — Slack response_urls are always hooks.slack.com.
  //   2. assertSafeURL — belt-and-braces against numeric IP / metadata host
  //      attempts that happen to spoof the hostname check (e.g. a `hooks.slack.com`
  //      DNS entry pointing at 169.254.169.254).
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    logger.warn("Slack response_url rejected — unparseable", { url });
    return;
  }
  if (parsed.hostname.toLowerCase() !== SLACK_RESPONSE_HOST) {
    logger.warn("Slack response_url rejected — unexpected hostname", {
      hostname: parsed.hostname,
    });
    return;
  }
  try {
    assertSafeURL(url);
  } catch (err) {
    logger.warn("Slack response_url rejected by assertSafeURL", {
      error: String(err),
    });
    return;
  }

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
