import { runAnalysisCore } from "@askarthur/scam-engine/analyze-core";
import type { AnalysisResult } from "@askarthur/types";

/**
 * Run the full scam analysis pipeline for a bot message.
 *
 * Thin wrapper around runAnalysisCore with the bot-specific defaults:
 *   - surface: "bot" — namespaces the analyze-cache (so the same text
 *     pasted in the web app and via Telegram don't collide)
 *   - backgroundMode: "fire-and-forget" — bots run outside Vercel's
 *     waitUntil envelope, so we kick off storeVerifiedScam +
 *     incrementStats inline with .catch() guards
 *   - skipCacheRead/Write are NOT set: bots benefit from the same
 *     cache hit rate as web — duplicate scam pastes are common in chat
 *
 * Behavioural change vs. the pre-Phase-5 implementation: the
 * confidence-bumping (Math.max(0.9) on URL escalation, Math.max(0.6)
 * on injection floor) is gone — runAnalysisCore preserves the AI's
 * raw confidence after merging signals. Other surfaces never had the
 * bump; bots are now consistent. Red-flag phrasing also moves to the
 * canonical "URL flagged by X and Y: <url>" / "manipulation patterns"
 * strings shared across all surfaces.
 */
export async function analyzeForBot(
  text: string,
  region?: string,
  images?: string[],
): Promise<AnalysisResult> {
  const out = await runAnalysisCore({
    text,
    surface: "bot",
    region: region ?? null,
    images,
    backgroundMode: "fire-and-forget",
  });
  return out.result;
}
