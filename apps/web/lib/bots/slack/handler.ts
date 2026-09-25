import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toSlackBlocks } from "@askarthur/bot-core/format-slack";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { FETCH_DEFAULT_MAX_REDIRECTS, safeFetch } from "@askarthur/scam-engine/safe-fetch";
import { logger } from "@askarthur/utils/logger";

// Slack's slash-command webhook hands us a `response_url` we POST the
// verdict back to. The token only authorises Slack as the producer of
// the payload, not the URL — so without a hostname check the route is a
// confused-deputy SSRF: a forged `response_url` could point at internal
// infra and our server would oblige. Slack always uses hooks.slack.com
// for response_urls (separate from incoming webhooks at
// hooks.slack.com/services/...), so the allowlist is a single host.
const SLACK_RESPONSE_HOSTS: ReadonlySet<string> = new Set(["hooks.slack.com"]);

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

/**
 * POST to a Slack `response_url`. Shared by the slash-command handler and the
 * message-shortcut route. safeFetch enforces the host allowlist (Slack
 * response_urls are always hooks.slack.com), the private-host guard, the
 * SSRF-safe dispatcher at connect, per-hop redirect checks (every hop must
 * stay on the allowlist), and a timeout.
 */
export async function postToResponseUrl(url: string, body: unknown): Promise<void> {
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // Every hop must stay on hooks.slack.com; fetch's default hop limit.
    allowHosts: SLACK_RESPONSE_HOSTS,
    redirect: "follow-checked",
    maxRedirects: FETCH_DEFAULT_MAX_REDIRECTS,
    as: "none",
    timeoutMs: 10_000,
  });
  if (res.ok) return;
  if (res.reason === "blocked") {
    logger.warn("Slack response_url rejected", { detail: res.detail });
  } else if (res.reason === "http") {
    logger.error("Slack response_url POST failed", { status: res.status });
  } else {
    logger.error("Slack response_url POST error", { error: res.detail });
  }
}
