import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "./logger";
import { hashIdentifier } from "./hash";

// Two-tier rate limiting:
// - Burst: 3 checks per hour (covers quick succession use case)
// - Daily: 10 checks per day (outer safety limit)

let _burstLimiter: Ratelimit | null = null;
let _dailyLimiter: Ratelimit | null = null;
let _formLimiter: Ratelimit | null = null;
let _imageUploadLimiter: Ratelimit | null = null;

function getBurstLimiter() {
  if (!_burstLimiter) {
    _burstLimiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(3, "1 h"),
      prefix: "askarthur:burst",
    });
  }
  return _burstLimiter;
}

function getDailyLimiter() {
  if (!_dailyLimiter) {
    _dailyLimiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(10, "24 h"),
      prefix: "askarthur:daily",
    });
  }
  return _dailyLimiter;
}

function getFormLimiter() {
  if (!_formLimiter) {
    _formLimiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "askarthur:form",
    });
  }
  return _formLimiter;
}

function getImageUploadLimiter() {
  if (!_imageUploadLimiter) {
    _imageUploadLimiter = new Ratelimit({
      redis: new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      }),
      limiter: Ratelimit.slidingWindow(5, "1 h"),
      prefix: "askarthur:image-upload",
      analytics: true,
      timeout: 1000,
    });
  }
  return _imageUploadLimiter;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  message?: string;
};

/**
 * Behaviour when the rate-limit store (Upstash Redis) is unreachable or
 * misconfigured:
 * - **"closed"**: deny the request (HTTP 503). Use when the cost of a missed
 *   block dominates the cost of a rare false reject — e.g. Claude vision,
 *   Twilio lookups, anything where an attacker can spend your money.
 * - **"open"**: allow the request. Use for cheap / high-volume paths where
 *   legit users > abuse protection — e.g. marketing form submissions.
 */
export type FailMode = "open" | "closed";

/**
 * Default failure behaviour for a bucket: closed in production (prefer
 * safety), open in dev (don't block local iteration when Redis isn't
 * configured). Callers can override at the call site per the blueprint's
 * policy table.
 */
function defaultFailMode(): FailMode {
  return process.env.NODE_ENV === "production" ? "closed" : "open";
}

function storeUnavailable(mode: FailMode, label: string): RateLimitResult {
  if (mode === "closed") {
    logger.error(`${label}: store unavailable — failing CLOSED`);
    return {
      allowed: false,
      remaining: 0,
      resetAt: null,
      message: "Service temporarily unavailable.",
    };
  }
  return { allowed: true, remaining: 99, resetAt: null };
}

export async function checkRateLimit(
  ip: string,
  userAgent: string,
  failMode: FailMode = defaultFailMode()
): Promise<RateLimitResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return storeUnavailable(failMode, "checkRateLimit");
  }

  const identifier = await hashIdentifier(ip, userAgent || "unknown");

  try {
    // Check burst limit first (stricter)
    const burst = await getBurstLimiter().limit(identifier);
    if (!burst.success) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(burst.reset),
        message:
          "You've checked a few messages already — come back in a bit! The limit resets every hour.",
      };
    }

    // Check daily limit
    const daily = await getDailyLimiter().limit(identifier);
    if (!daily.success) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(daily.reset),
        message:
          "You've reached today's limit of 10 checks. Come back tomorrow for more — we want to keep this free for everyone!",
      };
    }

    return {
      allowed: true,
      remaining: Math.min(burst.remaining, daily.remaining),
      resetAt: null,
    };
  } catch (err) {
    logger.error("checkRateLimit: store error", { error: String(err) });
    return storeUnavailable(failMode, "checkRateLimit");
  }
}

export async function checkImageUploadRateLimit(
  ip: string,
  failMode: FailMode = defaultFailMode()
): Promise<RateLimitResult> {
  // Image vision calls cost ~$0.002-$0.01 each. Default failMode is "closed"
  // in production — the cost of a miss (unbounded Anthropic spend) far
  // exceeds the cost of a rare false block during a Redis blip.
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return storeUnavailable(failMode, "checkImageUploadRateLimit");
  }

  try {
    const result = await getImageUploadLimiter().limit(`ip:${ip}`);
    if (!result.success) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(result.reset),
        message: "Too many image uploads. Try again later.",
      };
    }
    return { allowed: true, remaining: result.remaining, resetAt: null };
  } catch (err) {
    logger.error("checkImageUploadRateLimit: store error", { error: String(err) });
    return storeUnavailable(failMode, "checkImageUploadRateLimit");
  }
}

export async function checkFormRateLimit(
  ip: string,
  failMode: FailMode = defaultFailMode()
): Promise<RateLimitResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return storeUnavailable(failMode, "checkFormRateLimit");
  }

  try {
    const identifier = ip;
    const result = await getFormLimiter().limit(identifier);

    if (!result.success) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(result.reset),
        message: "Too many submissions. Please try again later.",
      };
    }

    return {
      allowed: true,
      remaining: result.remaining,
      resetAt: null,
    };
  } catch (err) {
    logger.error("checkFormRateLimit: store error", { error: String(err) });
    return storeUnavailable(failMode, "checkFormRateLimit");
  }
}
