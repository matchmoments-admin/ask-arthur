import { Redis } from "@upstash/redis";
import {
  PROMPT_VERSION,
  type AnalysisResult,
  type AnalysisMode,
  type Verdict,
} from "@askarthur/types";
import { logger } from "@askarthur/utils/logger";
import { scrubPII } from "./pipeline";
import { SYSTEM_PROMPT_HASH } from "./claude";

// ── Cache key design ────────────────────────────────────────────────────
//
//   askarthur:analysis:p{PROMPT_VERSION}:m{model}:s{systemHash8}:t{textHash}:i{imagesHash}:f{flagsHash}:mode{T|I|TI|U}
//
// Axes included:
//   - p{PROMPT_VERSION}    manual bump for model swaps / intentional prompt changes
//   - s{systemHash8}       auto-derived; invalidates on any prompt edit (even typos)
//   - m{model}             different Claude model families never conflate results
//   - t{textHash}          normalized input text hash
//   - i{imagesHash}        concatenated per-image content hash (empty sentinel for text-only)
//   - f{flagsHash}         hash of caller-supplied output-affecting feature flags
//   - mode{T|I|TI|U}       explicit mode for trivial Redis SCAN filtering
//
// TTL is verdict-dependent (see `TTL_BY_VERDICT` below): HIGH_RISK evictions
// happen fast because malicious infrastructure churns; SAFE holds longest.

const DEFAULT_MODEL_SHORT = "haiku45";
const CACHE_PREFIX = `askarthur:analysis:p${PROMPT_VERSION}`;

/**
 * Per-verdict TTL (seconds). Short HIGH_RISK holds prevent stale "scam"
 * verdicts from a URL that's since been taken down; long SAFE holds
 * maximize cache-hit rate on the majority-case.
 */
const TTL_BY_VERDICT: Record<Verdict, number> = {
  SAFE: 48 * 3600, // 48h
  UNCERTAIN: 1 * 3600, // 1h
  SUSPICIOUS: 6 * 3600, // 6h
  HIGH_RISK: 15 * 60, // 15min
};

/** Fallback TTL when no verdict is available (shouldn't happen in practice). */
const FALLBACK_TTL_SECONDS = 3600;

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

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Canonical-JSON hash of a plain object. Keys are sorted so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same hash.
 * Caller must pass a shallow object of primitives (no nested objects, no functions).
 */
async function sha256OfObject(
  obj: Record<string, boolean | string | number | null | undefined>
): Promise<string> {
  const sortedKeys = Object.keys(obj).sort();
  const canonical = sortedKeys.map((k) => `${k}:${String(obj[k])}`).join("|");
  return sha256Hex(canonical);
}

/**
 * Produce the `images` hash axis. Per-image SHA-256s are concatenated in
 * the original order (order matters — swapping image positions is a
 * different request) and re-hashed.
 *
 * Returns a fixed-length sentinel "0" for the text-only case so text-only
 * keys differ from "images: []" keys without ambiguity.
 */
async function hashImageList(images: string[] | undefined): Promise<string> {
  if (!images || images.length === 0) return "0";
  const perImage = await Promise.all(images.map(sha256Hex));
  return (await sha256Hex(perImage.join("|"))).slice(0, 16);
}

/**
 * Input to both cache read and cache write. `text` and/or `images` drive
 * the content-addressable axes; `mode` + `modelShort` + `outputAffectingFlags`
 * scope the key to a particular invocation shape.
 */
export interface AnalyzeCacheInput {
  text?: string;
  images?: string[];
  mode?: AnalysisMode;
  modelShort?: string;
  /**
   * Caller-supplied feature flags that change Claude's output (e.g.
   * `{ redirectResolve: true }`). Only include flags that affect the
   * cached `AnalysisResult` — NOT flags that govern post-Claude enrichment.
   */
  outputAffectingFlags?: Record<string, boolean | string | number>;
}

function modeTag(input: AnalyzeCacheInput): string {
  const hasText = !!input.text && input.text.length > 0;
  const hasImages = !!input.images && input.images.length > 0;
  if (hasText && hasImages) return "TI";
  if (hasImages) return "I";
  if (hasText) return "T";
  return "U";
}

/**
 * Build a composite versioned cache key. Async because image + text hashes
 * are async (Web Crypto `subtle.digest`).
 */
export async function buildAnalyzeCacheKey(input: AnalyzeCacheInput): Promise<string> {
  const model = input.modelShort ?? DEFAULT_MODEL_SHORT;
  const textHash = input.text ? (await sha256Hex(input.text)).slice(0, 16) : "0";
  const imagesHash = await hashImageList(input.images);
  const flagsHash = input.outputAffectingFlags
    ? (await sha256OfObject(input.outputAffectingFlags)).slice(0, 8)
    : "0";
  return `${CACHE_PREFIX}:m${model}:s${SYSTEM_PROMPT_HASH}:t${textHash}:i${imagesHash}:f${flagsHash}:mode${modeTag(input)}`;
}

/**
 * Victim-PII scrub for the pre-write path. See inline comment — must be run
 * before the result enters the shared cache.
 */
function scrubCacheablePII(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    summary: scrubPII(result.summary),
    redFlags: result.redFlags.map(scrubPII),
    nextSteps: result.nextSteps.map(scrubPII),
  };
}

/** Accept a legacy string arg (text only) OR the new object form. */
function normalizeInput(inputOrText: string | AnalyzeCacheInput): AnalyzeCacheInput {
  return typeof inputOrText === "string" ? { text: inputOrText } : inputOrText;
}

/** Get a cached analysis result keyed by the composite key. */
export async function getCachedAnalysis(
  inputOrText: string | AnalyzeCacheInput
): Promise<AnalysisResult | null> {
  const redis = getRedis();
  if (!redis) return null;

  const input = normalizeInput(inputOrText);
  try {
    const key = await buildAnalyzeCacheKey(input);
    const cached = await redis.get<AnalysisResult>(key);
    if (cached) {
      logger.info("Analysis cache hit", { keyTail: key.slice(-24) });
    }
    return cached;
  } catch (err) {
    logger.warn("Analysis cache get failed", { error: String(err) });
    return null;
  }
}

/**
 * Cache an analysis result. PII is scrubbed from `summary` / `redFlags` /
 * `nextSteps` before write — cached values can be served to a different user
 * whose input hashes to the same key. TTL is chosen based on the result's
 * verdict (see `TTL_BY_VERDICT`).
 */
export async function setCachedAnalysis(
  inputOrText: string | AnalyzeCacheInput,
  result: AnalysisResult
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const input = normalizeInput(inputOrText);
  try {
    const key = await buildAnalyzeCacheKey(input);
    const scrubbed = scrubCacheablePII(result);
    const ttl = TTL_BY_VERDICT[result.verdict] ?? FALLBACK_TTL_SECONDS;
    await redis.set(key, scrubbed, { ex: ttl });
  } catch (err) {
    logger.warn("Analysis cache set failed", { error: String(err) });
  }
}
