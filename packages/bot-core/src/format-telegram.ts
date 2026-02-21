import type { AnalysisResult } from "@askarthur/types";

const VERDICT_EMOJI: Record<string, string> = {
  SAFE: "\u2705",
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

  lines.push(`${emoji} <b>Verdict: ${result.verdict.replace("_", " ")}</b> (${confidence}% confidence)`);
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

  lines.push("");
  lines.push("<i>Powered by Ask Arthur \u2014 askarthur.au</i>");

  return lines.join("\n");
}
