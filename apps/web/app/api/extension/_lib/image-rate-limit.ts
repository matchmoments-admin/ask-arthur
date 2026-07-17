import { Redis } from "@upstash/redis";

// Per-install daily cap on paid image scans, generalised from the fixed
// 10/day limiter inlined in analyze-ad (which keeps its own key + cap —
// Facebook-ad image scans and right-click image checks are budgeted
// independently). The cap is tier-dependent and passed by the caller from
// EXTENSION_TIER_LIMITS[tier].imageChecksPerDay.

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export interface ImageRateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Count an image check against the install's daily cap. Increments first,
 * then compares — an over-cap request still consumes nothing extra tomorrow
 * (48h TTL covers timezone stragglers, same as analyze-ad's limiter).
 * Fail-open in dev, fail-closed in prod when Redis is unconfigured.
 */
export async function checkImageCheckRateLimit(
  installId: string,
  cap: number,
): Promise<ImageRateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    return process.env.NODE_ENV !== "production"
      ? { allowed: true, remaining: cap }
      : { allowed: false, remaining: 0 };
  }

  const data = new TextEncoder().encode(installId);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const idHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const today = new Date().toISOString().slice(0, 10);
  const key = `askarthur:ext:imgcheck:${idHash}:${today}`;

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 48 * 60 * 60);
  }

  return { allowed: count <= cap, remaining: Math.max(0, cap - count) };
}
