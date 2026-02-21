import type { AnalysisResult } from "@askarthur/types";

const VERDICT_EMOJI: Record<string, string> = {
  SAFE: "\u2705",
  SUSPICIOUS: "\u26a0\ufe0f",
  HIGH_RISK: "\ud83d\udea8",
};

/**
 * Format an AnalysisResult as plain text for WhatsApp.
 * WhatsApp supports limited formatting: *bold*, _italic_, ~strikethrough~, ```monospace```.
 */
export function toWhatsAppMessage(result: AnalysisResult): string {
  const emoji = VERDICT_EMOJI[result.verdict] ?? "";
  const confidence = Math.round(result.confidence * 100);
  const lines: string[] = [];

  lines.push(`${emoji} *Verdict: ${result.verdict.replace("_", " ")}* (${confidence}% confidence)`);
  lines.push("");
  lines.push(result.summary);

  if (result.redFlags.length > 0) {
    lines.push("");
    lines.push("*Red Flags:*");
    for (const flag of result.redFlags.slice(0, 5)) {
      lines.push(`\u2022 ${flag}`);
    }
  }

  if (result.nextSteps.length > 0) {
    lines.push("");
    lines.push("*What to do:*");
    for (const step of result.nextSteps.slice(0, 3)) {
      lines.push(`\u2022 ${step}`);
    }
  }

  if (result.scamType && result.scamType !== "none") {
    lines.push("");
    lines.push(`*Type:* ${result.scamType}`);
  }

  lines.push("");
  lines.push("_Powered by Ask Arthur \u2014 askarthur.au_");

  return lines.join("\n");
}
