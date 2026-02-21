// Phase 2 — Fallback deepfake detection provider (~$2.40/1,000 min).
// Requires: RESEMBLE_AI_API_TOKEN env var. Called via lib/deepfakeDetection.ts.

import { logger } from "@askarthur/utils/logger";

// Corrected endpoint: /api/v2/intelligence (not /api/v2/detect)
const RESEMBLE_API = "https://app.resemble.ai/api/v2";

export interface ResembleDeepfakeResult {
  isLikelyDeepfake: boolean;
  score: number;
  label: "real" | "fake";
  provider: "resemble_ai";
  raw: Record<string, unknown>;
}

/**
 * Detect deepfake via Resemble AI Intelligence API.
 * Takes a publicly accessible URL (presigned R2 GET URL).
 * Pricing: Flex Plan ~$2.40/1,000 minutes of audio.
 */
export async function detectDeepfakeResemble(
  mediaUrl: string
): Promise<ResembleDeepfakeResult> {
  const token = process.env.RESEMBLE_AI_API_TOKEN;
  if (!token) throw new Error("RESEMBLE_AI_API_TOKEN not set");

  const createRes = await fetch(`${RESEMBLE_API}/intelligence`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: mediaUrl }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    logger.error("Resemble AI create failed", { status: createRes.status, body: err });
    throw new Error(`Resemble AI detection failed: ${createRes.status}`);
  }

  const { item } = await createRes.json();

  // Poll for results (typically 5-15 seconds)
  let result;
  let attempts = 0;
  const MAX_ATTEMPTS = 30; // 60 seconds max

  do {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`${RESEMBLE_API}/intelligence/${item.uuid}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!pollRes.ok) throw new Error(`Resemble AI poll failed: ${pollRes.status}`);
    result = (await pollRes.json()).item;
    attempts++;
  } while (result.status === "processing" && attempts < MAX_ATTEMPTS);

  if (result.status === "processing") {
    throw new Error("Resemble AI detection timed out");
  }

  const aggregatedScore = parseFloat(result.metrics?.aggregated_score ?? "0.5");

  return {
    isLikelyDeepfake: result.metrics?.label === "fake",
    score: aggregatedScore,
    label: result.metrics?.label ?? "real",
    provider: "resemble_ai",
    raw: {
      uuid: item.uuid,
      metrics: result.metrics,
      status: result.status,
    },
  };
}
