// Redis-backed cache in front of Voyage / OpenAI embeddings.
//
// Single-text calls only — multi-text batches are typically document
// embeddings during backfills where every text is unique, so caching
// them adds Redis MGET overhead without a hit. Single-text calls are
// the common shape from embedQuery() at request time, where the same
// text often gets embedded repeatedly across users (popular scam-text
// paraphrases, B2B clients re-querying similar narratives).
//
// Cache key includes (modelId, inputType, text-hash) — model id is
// load-bearing per ADR-0003 (vectors from different models live in
// different geometric spaces). inputType matters because Voyage's
// asymmetric prompt produces a different vector for "document" vs
// "query" of the same text.
//
// TTL is 7 days. Embedding is deterministic for a given (model,
// inputType, text); the only invalidator is a model swap, and ADR-0003's
// reindex policy already covers that path (re-embed all rows then flip
// the default). 7 days is a balance between cache hit rate and
// natural rotation if we ever discover a stale embedding.
//
// No-ops gracefully when Upstash env vars aren't set — same pattern as
// analysis-cache.ts and ipqualityscore.ts.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

const CACHE_PREFIX = "askarthur:embed:v1";
const TTL_SECONDS = 7 * 24 * 3600; // 7 days

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
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

/** Cached embedding payload — vectors only, plus the model id used. */
export interface CachedEmbedding {
  vectors: number[][];
  modelId: string;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildKey(
  modelId: string,
  inputType: string,
  text: string,
): Promise<string> {
  // 16-hex prefix is collision-safe at our scale (~64 bits) and keeps
  // Redis keys short. Full SHA on (modelId, inputType, text) so a model
  // change or document/query swap invalidates cleanly.
  const hash = await sha256Hex(`${modelId}|${inputType}|${text}`);
  return `${CACHE_PREFIX}:m${modelId}:i${inputType}:t${hash.slice(0, 32)}`;
}

/**
 * Look up a cached embedding for a single (modelId, inputType, text)
 * triple. Returns null on miss or any Redis error — the caller falls
 * back to the live embed call. Never throws.
 */
export async function getCachedEmbedding(
  modelId: string,
  inputType: string,
  text: string,
): Promise<CachedEmbedding | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const key = await buildKey(modelId, inputType, text);
    const cached = await redis.get<CachedEmbedding>(key);
    return cached ?? null;
  } catch (err) {
    logger.warn("embedding-cache: lookup failed, falling back to live", {
      error: String(err),
    });
    return null;
  }
}

/**
 * Persist a fresh embedding for a single (modelId, inputType, text)
 * triple. Fire-and-forget — failures are logged but never propagated.
 */
export async function setCachedEmbedding(
  modelId: string,
  inputType: string,
  text: string,
  vectors: number[][],
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    const key = await buildKey(modelId, inputType, text);
    await redis.set<CachedEmbedding>(key, { vectors, modelId }, {
      ex: TTL_SECONDS,
    });
  } catch (err) {
    logger.warn("embedding-cache: set failed", { error: String(err) });
  }
}
