// Phase 2 — Primary deepfake detection provider (free tier: 50 scans/month).
// Requires: REALITY_DEFENDER_API_KEY env var. Called via lib/deepfakeDetection.ts.

import { RealityDefender } from "@realitydefender/realitydefender";
import { logger } from "./logger";

export interface DeepfakeResult {
  isLikelyDeepfake: boolean;
  score: number; // 0–1, higher = more likely manipulated
  provider: "reality_defender" | "resemble_ai";
  status: string;
  raw: Record<string, unknown>;
}

let _client: RealityDefender | null = null;

function getClient(): RealityDefender | null {
  if (_client) return _client;
  const apiKey = process.env.REALITY_DEFENDER_API_KEY;
  if (!apiKey) {
    logger.warn("REALITY_DEFENDER_API_KEY not set");
    return null;
  }
  _client = new RealityDefender({ apiKey });
  return _client;
}

/**
 * Detect deepfake audio/image via Reality Defender.
 * Requires file on disk (Inngest step writes buffer to /tmp).
 * SDK handles: presigned URL → upload → polling → result.
 *
 * Score interpretation:
 *   < 0.3 = likely authentic
 *   0.3–0.7 = uncertain (flag for review)
 *   > 0.7 = likely AI-generated
 */
export async function detectDeepfakeRD(filePath: string): Promise<DeepfakeResult> {
  const client = getClient();
  if (!client) throw new Error("Reality Defender not configured");

  const { requestId } = await client.upload({ filePath });
  const result = await client.getResult(requestId);

  const score = result.score ?? 0.5; // Default to uncertain if null

  return {
    isLikelyDeepfake: score > 0.7,
    score,
    provider: "reality_defender",
    status: result.status,
    raw: {
      requestId,
      models: result.models,
      score,
      status: result.status,
    },
  };
}
