import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

export interface HiveAIResult {
  isAiGenerated: boolean;
  aiConfidence: number;
  isDeepfake: boolean;
  deepfakeConfidence: number;
  generatorSource: string | null;
}

const CACHE_TTL_SECONDS = 86_400; // 24 hours
const CACHE_PREFIX = "askarthur:hive";
const HIVE_API_URL = "https://api.thehive.ai/api/v2/task/sync";
const FETCH_TIMEOUT_MS = 5_000;
const AI_GENERATED_THRESHOLD = 0.9;
const DEEPFAKE_THRESHOLD = 0.9;

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Check an image URL against Hive AI for AI-generated content and deepfake detection.
 * Returns null if HIVE_API_KEY is not configured or on any error.
 */
export async function checkHiveAI(imageUrl: string): Promise<HiveAIResult | null> {
  const apiKey = process.env.HIVE_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    // Check Redis cache first
    const redis = getRedis();
    const hash = await sha256(imageUrl);
    const cacheKey = `${CACHE_PREFIX}:${hash}`;

    if (redis) {
      const cached = await redis.get<HiveAIResult>(cacheKey);
      if (cached) {
        logger.info("Hive AI cache hit", { imageUrl: imageUrl.slice(0, 80) });
        return cached;
      }
    }

    // Build FormData with the image URL
    const formData = new FormData();
    formData.append("url", imageUrl);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(HIVE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn("Hive AI API error", { status: res.status, imageUrl: imageUrl.slice(0, 80) });
      return null;
    }

    const json = await res.json();

    // Parse response: data.status[0].response.output
    const output = json?.data?.status?.[0]?.response?.output;
    if (!Array.isArray(output)) {
      logger.warn("Hive AI unexpected response shape", { imageUrl: imageUrl.slice(0, 80) });
      return null;
    }

    let aiConfidence = 0;
    let deepfakeConfidence = 0;
    let generatorSource: string | null = null;
    let highestSourceScore = 0;

    for (const item of output) {
      const classes = item?.classes;
      if (!Array.isArray(classes)) continue;

      for (const cls of classes) {
        const className = cls?.class;
        const score = typeof cls?.score === "number" ? cls.score : 0;

        if (className === "ai_generated") {
          aiConfidence = Math.max(aiConfidence, score);
        } else if (className === "deepfake") {
          deepfakeConfidence = Math.max(deepfakeConfidence, score);
        } else if (className === "not_ai_generated") {
          // skip
        } else if (score > highestSourceScore) {
          // Track generator source as the highest-scoring non-standard class
          highestSourceScore = score;
          generatorSource = className;
        }
      }
    }

    const result: HiveAIResult = {
      isAiGenerated: aiConfidence >= AI_GENERATED_THRESHOLD,
      aiConfidence,
      isDeepfake: deepfakeConfidence >= DEEPFAKE_THRESHOLD,
      deepfakeConfidence,
      generatorSource,
    };

    // Cache result
    if (redis) {
      await redis.set(cacheKey, result, { ex: CACHE_TTL_SECONDS }).catch((err) => {
        logger.warn("Hive AI cache set failed", { error: String(err) });
      });
    }

    return result;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      logger.warn("Hive AI request timed out", { imageUrl: imageUrl.slice(0, 80) });
    } else {
      logger.error("Hive AI check failed", { error: String(err), imageUrl: imageUrl.slice(0, 80) });
    }
    return null;
  }
}
