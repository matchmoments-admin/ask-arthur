import { runAnalysisCore } from "@askarthur/scam-engine/analyze-core";
import { logCost, isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { MODELS } from "@askarthur/scam-engine/anthropic";
import type { AnalysisResult } from "@askarthur/types";

/**
 * Thrown by analyzeForBot when the `bot_analyze` cost brake is engaged
 * (cost-daily-check tripped the daily cap). Bot handlers catch this and
 * send a "high demand — use the web checker" fallback rather than the
 * generic error, so a user still gets pointed somewhere useful.
 */
export class BotAnalysisPausedError extends Error {
  constructor() {
    super("bot_analyze cost brake engaged");
    this.name = "BotAnalysisPausedError";
  }
}

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
  // Circuit-breaker: if today's bot AI spend tripped its cap, stop here.
  // Throwing lets handlers send a graceful fallback instead of silently
  // burning more budget. Best-effort check — a DB error fails open.
  if (await isFeatureBraked("bot_analyze")) {
    throw new BotAnalysisPausedError();
  }

  const out = await runAnalysisCore({
    text,
    surface: "bot",
    region: region ?? null,
    images,
    backgroundMode: "fire-and-forget",
  });

  // Cost telemetry. Mirror the extension route's pattern: log ONLY on a
  // real billable call (cache MISS with usage present) so cached replies
  // don't inflate spend. Without this, bot AI spend is invisible to
  // /admin/costs and the weekly Telegram digest. Bots run Haiku 4.5.
  if (!out.cached && out.result.usage) {
    const u = out.result.usage;
    const spec = MODELS.HAIKU_4_5;
    const cacheReadTokens = u.cacheReadInputTokens ?? 0;
    const estimatedCostUsd =
      u.inputTokens * spec.inputUsdPerToken +
      u.outputTokens * spec.outputUsdPerToken +
      cacheReadTokens * spec.cacheReadUsdPerToken;
    void logCost({
      feature: "bot_analyze",
      provider: "anthropic",
      operation: spec.id,
      units: u.inputTokens + u.outputTokens,
      estimatedCostUsd,
      metadata: {
        mode: images?.length ? "image" : "text",
        verdict: out.result.verdict,
        cacheReadTokens,
      },
    });
  }

  return out.result;
}
