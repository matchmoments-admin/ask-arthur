import { analyzeWithClaude, detectInjectionAttempt } from "@askarthur/scam-engine/claude";
import { extractURLs, checkURLReputation } from "@askarthur/scam-engine/safebrowsing";
import { storeVerifiedScam, incrementStats } from "@askarthur/scam-engine/pipeline";
import { logger } from "@askarthur/utils/logger";
import type { AnalysisResult } from "@askarthur/types";

/**
 * Run the full scam analysis pipeline for a bot message.
 * Same logic as /api/analyze but called directly (no HTTP hop).
 */
export async function analyzeForBot(text: string, region?: string): Promise<AnalysisResult> {
  // 1. Injection pre-filter
  const injection = detectInjectionAttempt(text);

  // 2. Extract URLs
  const urls = extractURLs(text);

  // 3. Run Claude analysis + URL reputation in parallel
  const [analysis, urlResults] = await Promise.all([
    analyzeWithClaude(text),
    urls.length > 0 ? checkURLReputation(urls) : Promise.resolve([]),
  ]);

  // 4. Merge verdicts — malicious URLs escalate to HIGH_RISK
  let result = { ...analysis };
  const maliciousURLs = urlResults.filter((u) => u.isMalicious);

  if (maliciousURLs.length > 0 && result.verdict !== "HIGH_RISK") {
    result.verdict = "HIGH_RISK";
    result.confidence = Math.max(result.confidence, 0.9);
    result.redFlags = [
      ...result.redFlags,
      ...maliciousURLs.map((u) => `Malicious URL detected: ${u.url} (flagged by ${u.sources.join(", ")})`),
    ];
  }

  // Injection detected → floor to SUSPICIOUS minimum
  if (injection.detected && result.verdict === "SAFE") {
    result.verdict = "SUSPICIOUS";
    result.confidence = Math.max(result.confidence, 0.6);
  }

  // 5. Background: store verified scams + increment stats
  const regionStr = region ?? null;
  if (result.verdict === "HIGH_RISK") {
    storeVerifiedScam(result, regionStr).catch((err) =>
      logger.error("Failed to store verified scam from bot", { error: String(err) })
    );
  }
  incrementStats(result.verdict, regionStr).catch((err) =>
    logger.error("Failed to increment stats from bot", { error: String(err) })
  );

  return result;
}
