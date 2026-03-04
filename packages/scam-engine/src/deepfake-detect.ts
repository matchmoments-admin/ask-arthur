import { logger } from "@askarthur/utils/logger";

interface DeepfakeResult {
  isDeepfake: boolean;
  confidence: number;
  provider: string;
  details?: Record<string, unknown>;
}

/**
 * Analyze audio for deepfake characteristics using an external API.
 * Supports multiple providers with fallback.
 */
export async function analyzeAudioForDeepfake(
  audioBuffer: ArrayBuffer,
  mimeType: string
): Promise<DeepfakeResult> {
  // Try Reality Defender first
  const realityDefenderKey = process.env.REALITY_DEFENDER_API_KEY;
  if (realityDefenderKey) {
    try {
      return await analyzeWithRealityDefender(audioBuffer, mimeType, realityDefenderKey);
    } catch (err) {
      logger.warn("Reality Defender failed, trying fallback", { error: err });
    }
  }

  // Fallback: Resemble AI
  const resembleKey = process.env.RESEMBLE_AI_API_TOKEN;
  if (resembleKey) {
    try {
      return await analyzeWithResembleAI(audioBuffer, mimeType, resembleKey);
    } catch (err) {
      logger.warn("Resemble AI failed", { error: err });
    }
  }

  // No provider available
  return {
    isDeepfake: false,
    confidence: 0,
    provider: "none",
    details: { error: "No deepfake detection provider configured" },
  };
}

async function analyzeWithRealityDefender(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  apiKey: string
): Promise<DeepfakeResult> {
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), "audio");

  const res = await fetch("https://api.realitydefender.com/v1/audio/detect", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Reality Defender API error: ${res.status}`);
  }

  const data = await res.json();

  return {
    isDeepfake: data.is_synthetic ?? false,
    confidence: data.confidence ?? 0,
    provider: "reality_defender",
    details: data,
  };
}

async function analyzeWithResembleAI(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  apiKey: string
): Promise<DeepfakeResult> {
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: mimeType }), "audio");

  const res = await fetch("https://api.resemble.ai/v1/detect", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Resemble AI API error: ${res.status}`);
  }

  const data = await res.json();

  return {
    isDeepfake: (data.score ?? 0) > 0.7,
    confidence: data.score ?? 0,
    provider: "resemble_ai",
    details: data,
  };
}
