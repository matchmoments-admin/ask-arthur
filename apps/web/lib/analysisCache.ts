import "server-only";
import { Redis } from "@upstash/redis";
import { PROMPT_VERSION, type AnalysisResult } from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";

// Cache analysis results in Redis to avoid redundant Claude API calls.
// Key format: askarthur:analysis:v{PROMPT_VERSION}:{sha256(text)}
// TTL: 24 hours — scam content doesn't change after analysis.

const CACHE_TTL_SECONDS = 86_400; // 24 hours
const CACHE_PREFIX = `askarthur:analysis:v${PROMPT_VERSION}`;

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

async function hashText(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Get cached analysis result for text-only requests */
export async function getCachedAnalysis(text: string): Promise<AnalysisResult | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const hash = await hashText(text);
    const cached = await redis.get<AnalysisResult>(`${CACHE_PREFIX}:${hash}`);
    if (cached) {
      logger.info("Analysis cache hit", { hash: hash.slice(0, 12) });
    }
    return cached;
  } catch (err) {
    logger.warn("Analysis cache get failed", { error: String(err) });
    return null;
  }
}

/** Cache an analysis result for text-only requests */
export async function setCachedAnalysis(text: string, result: AnalysisResult): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const hash = await hashText(text);
    await redis.set(`${CACHE_PREFIX}:${hash}`, result, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    logger.warn("Analysis cache set failed", { error: String(err) });
  }
}
