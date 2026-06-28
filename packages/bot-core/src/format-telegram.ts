import { VERDICT_LABEL, type AnalysisResult } from "@askarthur/types";

// "Never reassure": SAFE uses a neutral eye (\ud83d\udc41\ufe0f), not a green tick \u2014 the
// lightest tier still nudges the user to stay alert (mirrors web ResultCard).
const VERDICT_EMOJI: Record<string, string> = {
  SAFE: "\ud83d\udc41\ufe0f",
  SUSPICIOUS: "\u26a0\ufe0f",
  HIGH_RISK: "\ud83d\udea8",
};

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format an AnalysisResult as Telegram HTML (parseMode: "HTML").
 */
export function toTelegramHTML(result: AnalysisResult): string {
  const emoji = VERDICT_EMOJI[result.verdict] ?? "";
  const confidence = Math.round(result.confidence * 100);
  const lines: string[] = [];

  const label = VERDICT_LABEL[result.verdict] ?? result.verdict;
  lines.push(`${emoji} <b>Verdict: ${label}</b> (${confidence}% confidence)`);
  lines.push("");
  lines.push(escapeHTML(result.summary));

  if (result.redFlags.length > 0) {
    lines.push("");
    lines.push("<b>Red Flags:</b>");
    for (const flag of result.redFlags.slice(0, 5)) {
      lines.push(`\u2022 ${escapeHTML(flag)}`);
    }
  }

  if (result.nextSteps.length > 0) {
    lines.push("");
    lines.push("<b>What to do:</b>");
    for (const step of result.nextSteps.slice(0, 3)) {
      lines.push(`\u2022 ${escapeHTML(step)}`);
    }
  }

  if (result.scamType && result.scamType !== "none") {
    lines.push("");
    lines.push(`<b>Type:</b> ${escapeHTML(result.scamType)}`);
  }

  // Shop Guard Stage 0 \u2014 single-line summary when shopSignal is attached.
  // Chat surfaces can't render chips so the four bot formatters all collapse
  // to a tagged comma-separated summary; the web ResultCard renders the
  // richer chip view.
  if (result.shopSignal) {
    const tags = result.shopSignal.commerceFlags;
    lines.push("");
    if (tags.length === 0) {
      lines.push("<b>Shop signals:</b> online shop detected");
    } else {
      lines.push(`<b>Shop signals:</b> ${escapeHTML(tags.slice(0, 5).join(", "))}`);
    }
  }

  lines.push("");
  lines.push("<i>Powered by Ask Arthur \u2014 askarthur.au</i>");

  return lines.join("\n");
}
