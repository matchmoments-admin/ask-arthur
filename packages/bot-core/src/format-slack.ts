import { VERDICT_LABEL, type AnalysisResult } from "@askarthur/types";

// "Never reassure": SAFE uses a neutral eye + amber attachment colour, not a
// green tick — the lightest tier still nudges the user (mirrors web ResultCard).
const VERDICT_EMOJI: Record<string, string> = {
  SAFE: ":eye:",
  SUSPICIOUS: ":warning:",
  HIGH_RISK: ":rotating_light:",
};

const VERDICT_COLOR: Record<string, string> = {
  SAFE: "#eab308",
  SUSPICIOUS: "#f59e0b",
  HIGH_RISK: "#ef4444",
};

interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  elements?: Array<{ type: string; text: string }>;
  fields?: Array<{ type: string; text: string }>;
}

interface SlackAttachment {
  color: string;
  blocks: SlackBlock[];
}

export interface SlackResponse {
  response_type: "ephemeral" | "in_channel";
  attachments: SlackAttachment[];
}

/**
 * Format an AnalysisResult as Slack Block Kit JSON (ephemeral response).
 */
export function toSlackBlocks(result: AnalysisResult): SlackResponse {
  const emoji = VERDICT_EMOJI[result.verdict] ?? "";
  const color = VERDICT_COLOR[result.verdict] ?? "#6b7280";
  const confidence = Math.round(result.confidence * 100);

  const blocks: SlackBlock[] = [];

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `${emoji} Verdict: ${VERDICT_LABEL[result.verdict] ?? result.verdict} (${confidence}%)`,
      emoji: true,
    },
  });

  // Summary
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: result.summary,
    },
  });

  // Red flags
  if (result.redFlags.length > 0) {
    const flagText = result.redFlags
      .slice(0, 5)
      .map((f) => `\u2022 ${f}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Red Flags:*\n${flagText}`,
      },
    });
  }

  // Next steps
  if (result.nextSteps.length > 0) {
    const stepsText = result.nextSteps
      .slice(0, 3)
      .map((s) => `\u2022 ${s}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*What to do:*\n${stepsText}`,
      },
    });
  }

  // Metadata fields
  if (result.scamType && result.scamType !== "none") {
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Type:* ${result.scamType}` },
        ...(result.channel ? [{ type: "mrkdwn", text: `*Channel:* ${result.channel}` }] : []),
      ],
    });
  }

  // Shop Guard Stage 0 — single-line summary in a section block. Block Kit
  // surfaces don't render chips well; comma-joined tags match the other
  // bot formatters.
  if (result.shopSignal) {
    const tags = result.shopSignal.commerceFlags;
    const body =
      tags.length === 0
        ? "online shop detected"
        : tags.slice(0, 5).join(", ");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Shop signals:* ${body}` },
    });
  }

  // Footer
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Powered by <https://askarthur.au|Ask Arthur>",
      },
    ],
  });

  return {
    response_type: "ephemeral",
    attachments: [{ color, blocks }],
  };
}
