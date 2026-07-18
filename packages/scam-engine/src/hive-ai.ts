import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

export interface HiveClassScore {
  class: string;
  score: number;
}

export interface HiveAIResult {
  isAiGenerated: boolean;
  aiConfidence: number;
  isDeepfake: boolean;
  deepfakeConfidence: number;
  generatorSource: string | null;
  /** Full raw class list from Hive (verdict classes + per-generator
   *  attribution scores). Optional: entries cached before this field
   *  existed won't carry it — readers must tolerate undefined. */
  classes?: HiveClassScore[];
}

const CACHE_TTL_SECONDS = 86_400; // 24 hours
// v3: migrated to Hive's V3 API (see checkHiveAI docstring). The response
// parsing changed shape (score field `value`, flat `output[0].classes`), so
// the prefix is bumped from v2 → v3: v2-shape entries age out via TTL and new
// code never reads them (and still-deployed v2 code never reads v3 entries).
const CACHE_PREFIX = "askarthur:hive:v3";
const HIVE_API_URL =
  "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection";
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
 *
 * Uses Hive's V3 API:
 *   POST https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection
 *   Authorization: Bearer <HIVE_API_KEY>   (V2 used `Token`)
 *   Content-Type: application/json
 *   body: { "input": [ { "media_url": "<imageUrl>" } ] }   (V2 used multipart FormData)
 *
 * Response is FLAT (V2 nested it under data.status[0].response.output):
 *   { task_id, model, output: [ { classes: [ { class, value }, ... ] } ] }
 * Score field is `value` (V2 used `score`). The generation head is
 * `ai_generated` / `not_ai_generated` and sums to 1; there is a `deepfake`
 * class; the remaining classes are generator attribution (midjourney, dalle,
 * flux, stablediffusion, sora, …). Thresholds unchanged (ai/deepfake ≥ 0.9).
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

    // V3 request body is JSON with a `media_url` field (V2 used multipart
    // FormData with a `url` field).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(HIVE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: [{ media_url: imageUrl }] }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      logger.warn("Hive AI API error", { status: res.status, imageUrl: imageUrl.slice(0, 80) });
      return null;
    }

    const json = await res.json();

    // Parse V3's flat response: output[0].classes (V2 nested it under
    // data.status[0].response.output). Score field is `value` (V2: `score`).
    const classes = json?.output?.[0]?.classes;
    if (!Array.isArray(classes)) {
      logger.warn("Hive AI unexpected response shape", { imageUrl: imageUrl.slice(0, 80) });
      return null;
    }

    let aiConfidence = 0;
    let deepfakeConfidence = 0;
    let generatorSource: string | null = null;
    let highestSourceScore = 0;
    const allClasses: HiveClassScore[] = [];

    for (const cls of classes) {
      const className = cls?.class;
      // V3 uses `value`; map it into our internal `score` field so downstream
      // consumers of HiveClassScore.score (generatorBreakdown) stay compatible.
      const score = typeof cls?.value === "number" ? cls.value : 0;
      if (typeof className !== "string") continue;

      allClasses.push({ class: className, score });

      if (className === "ai_generated") {
        aiConfidence = Math.max(aiConfidence, score);
      } else if (className === "deepfake") {
        deepfakeConfidence = Math.max(deepfakeConfidence, score);
      } else if (className === "not_ai_generated") {
        // skip — verdict complement, not a generator
      } else if (score > highestSourceScore) {
        // Track generator source as the highest-scoring attribution class
        highestSourceScore = score;
        generatorSource = className;
      }
    }

    const result: HiveAIResult = {
      isAiGenerated: aiConfidence >= AI_GENERATED_THRESHOLD,
      aiConfidence,
      isDeepfake: deepfakeConfidence >= DEEPFAKE_THRESHOLD,
      deepfakeConfidence,
      generatorSource,
      classes: allClasses,
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
