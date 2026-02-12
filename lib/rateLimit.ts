import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Two-tier rate limiting:
// - Burst: 3 checks per hour (covers quick succession use case)
// - Daily: 10 checks per day (outer safety limit)

let _burstLimiter: Ratelimit | null = null;
let _dailyLimiter: Ratelimit | null = null;
let _formLimiter: Ratelimit | null = null;

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

// Generate a privacy-preserving identifier from IP + User-Agent
async function hashIdentifier(ip: string, ua: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}:${ua}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  message?: string;
};

export async function checkRateLimit(
  ip: string,
  userAgent: string
): Promise<RateLimitResult> {
  // Fail-closed in production, fail-open in dev
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    if (process.env.NODE_ENV === "production") {
      console.error("[CRITICAL] UPSTASH_REDIS_REST_URL not set in production — blocking request");
      return { allowed: false, remaining: 0, resetAt: null, message: "Service temporarily unavailable." };
    }
    console.warn("[dev] Rate limiting disabled — UPSTASH_REDIS_REST_URL not set");
    return { allowed: true, remaining: 99, resetAt: null };
  }

  const identifier = await hashIdentifier(ip, userAgent || "unknown");

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
}

export async function checkFormRateLimit(ip: string): Promise<RateLimitResult> {
  // Fail-closed in production, fail-open in dev
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    if (process.env.NODE_ENV === "production") {
      console.error("[CRITICAL] UPSTASH_REDIS_REST_URL not set in production — blocking request");
      return { allowed: false, remaining: 0, resetAt: null, message: "Service temporarily unavailable." };
    }
    console.warn("[dev] Form rate limiting disabled — UPSTASH_REDIS_REST_URL not set");
    return { allowed: true, remaining: 99, resetAt: null };
  }

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
}
