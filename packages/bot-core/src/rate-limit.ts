import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import type { Platform } from "./types";

interface BotRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  message?: string;
}

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (limiter) return limiter;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  limiter = new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "askarthur:bot",
  });

  return limiter;
}

/**
 * Rate limit bot users: 5 checks per hour per platform+userId.
 * Fail-open in dev (no Redis), fail-closed in prod.
 */
export async function checkBotRateLimit(
  platform: Platform,
  userId: string
): Promise<BotRateLimitResult> {
  const rl = getLimiter();

  if (!rl) {
    if (process.env.NODE_ENV === "production") {
      logger.error("Bot rate limiter unavailable in production");
      return { allowed: false, remaining: 0, resetAt: null, message: "Service temporarily unavailable." };
    }
    // Fail-open in dev
    return { allowed: true, remaining: 99, resetAt: null };
  }

  try {
    const identifier = `${platform}:${userId}`;
    const result = await rl.limit(identifier);

    if (!result.success) {
      const resetAt = new Date(result.reset);
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        message: "You've reached the limit of 5 checks per hour. Please try again later!",
      };
    }

    return {
      allowed: true,
      remaining: result.remaining,
      resetAt: null,
    };
  } catch (err) {
    logger.error("Bot rate limit check failed", { error: String(err) });
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, remaining: 0, resetAt: null, message: "Service temporarily unavailable." };
    }
    return { allowed: true, remaining: 99, resetAt: null };
  }
}
