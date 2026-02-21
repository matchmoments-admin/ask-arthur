// Phase 2 — Not yet wired into the pipeline.
// Gated by: NEXT_PUBLIC_FF_DEEPFAKE feature flag + provider env vars.
// TODO: Call from Inngest media analysis function once Phase 1 pipeline is live.

import { detectDeepfakeRD, type DeepfakeResult } from "./realityDefender";
import { detectDeepfakeResemble } from "./resembleDetect";
import { logger } from "@askarthur/utils/logger";

/**
 * Attempt deepfake detection with primary provider (Reality Defender),
 * fall back to Resemble AI if unavailable or errored.
 *
 * filePath: Required for Reality Defender SDK (needs file on disk)
 * mediaUrl: Required for Resemble AI (needs accessible URL)
 */
export async function detectDeepfake(
  filePath: string,
  mediaUrl: string
): Promise<DeepfakeResult> {
  // Try Reality Defender first (ensemble, free tier)
  if (process.env.REALITY_DEFENDER_API_KEY) {
    try {
      return await detectDeepfakeRD(filePath);
    } catch (err) {
      logger.warn("Reality Defender failed, falling back to Resemble AI", {
        error: String(err),
      });
    }
  }

  // Fallback to Resemble AI
  if (process.env.RESEMBLE_AI_API_TOKEN) {
    try {
      const result = await detectDeepfakeResemble(mediaUrl);
      return {
        isLikelyDeepfake: result.isLikelyDeepfake,
        score: result.score,
        provider: "resemble_ai",
        status: result.label,
        raw: result.raw,
      };
    } catch (err) {
      logger.error("Resemble AI also failed", { error: String(err) });
      throw err;
    }
  }

  throw new Error("No deepfake detection provider configured");
}

export type { DeepfakeResult } from "./realityDefender";
