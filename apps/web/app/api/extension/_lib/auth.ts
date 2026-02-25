import { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

export type ExtensionAuthResult =
  | { valid: true; installId: string; remaining: number }
  | { valid: false; error: string; status: number; retryAfter?: string };

// Manual checks: 10/min burst, 50/day
let _burstLimiter: Ratelimit | null = null;
let _dailyLimiter: Ratelimit | null = null;

// Email scans: 20/min burst, 200/day (auto-scanning uses more quota)
let _emailBurstLimiter: Ratelimit | null = null;
let _emailDailyLimiter: Ratelimit | null = null;

function getRedis() {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}

function getBurstLimiter() {
  if (!_burstLimiter) {
    _burstLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(10, "1 m"),
      prefix: "askarthur:ext:burst",
    });
  }
  return _burstLimiter;
}

function getDailyLimiter() {
  if (!_dailyLimiter) {
    _dailyLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(50, "24 h"),
      prefix: "askarthur:ext:daily",
    });
  }
  return _dailyLimiter;
}

function getEmailBurstLimiter() {
  if (!_emailBurstLimiter) {
    _emailBurstLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      prefix: "askarthur:ext:email:burst",
    });
  }
  return _emailBurstLimiter;
}

function getEmailDailyLimiter() {
  if (!_emailDailyLimiter) {
    _emailDailyLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(200, "24 h"),
      prefix: "askarthur:ext:email:daily",
    });
  }
  return _emailDailyLimiter;
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;

  // Use crypto.subtle for timing-safe comparison
  let result = 0;
  for (let i = 0; i < bufA.byteLength; i++) {
    result |= bufA[i]! ^ bufB[i]!;
  }
  return result === 0;
}

export async function validateExtensionRequest(
  req: NextRequest
): Promise<ExtensionAuthResult> {
  // 1. Validate extension secret
  const secret = req.headers.get("x-extension-secret");
  const expectedSecret = process.env.EXTENSION_SECRET;

  if (!expectedSecret) {
    if (process.env.NODE_ENV === "production") {
      logger.error("EXTENSION_SECRET not set in production");
      return { valid: false, error: "Service unavailable", status: 503 };
    }
    logger.warn("EXTENSION_SECRET not set — skipping auth in dev");
  } else if (!secret || !timingSafeEqual(secret, expectedSecret)) {
    return { valid: false, error: "Unauthorized", status: 401 };
  }

  // 2. Extract installation ID
  const installId = req.headers.get("x-extension-id");
  if (!installId || installId.length < 10 || installId.length > 64) {
    return { valid: false, error: "Invalid extension ID", status: 400 };
  }

  // 3. Rate limit on hashed installation ID
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    if (process.env.NODE_ENV === "production") {
      logger.error("UPSTASH_REDIS_REST_URL not set in production — blocking");
      return { valid: false, error: "Service unavailable", status: 503 };
    }
    return { valid: true, installId, remaining: 99 };
  }

  // Hash the install ID for privacy
  const data = new TextEncoder().encode(installId);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const identifier = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Select rate limit buckets based on scan source
  const scanSource = req.headers.get("x-scan-source");
  const isEmailScan = scanSource === "email";

  const burstLimiter = isEmailScan ? getEmailBurstLimiter() : getBurstLimiter();
  const dailyLimiter = isEmailScan ? getEmailDailyLimiter() : getDailyLimiter();
  const dailyLimit = isEmailScan ? 200 : 50;

  // Check burst limit first
  const burst = await burstLimiter.limit(identifier);
  if (!burst.success) {
    const retryAfter = String(
      Math.ceil((burst.reset - Date.now()) / 1000)
    );
    return {
      valid: false,
      error: "Too many requests. Please slow down.",
      status: 429,
      retryAfter,
    };
  }

  // Check daily limit
  const daily = await dailyLimiter.limit(identifier);
  if (!daily.success) {
    const retryAfter = String(
      Math.ceil((daily.reset - Date.now()) / 1000)
    );
    return {
      valid: false,
      error: `Daily limit reached (${dailyLimit} checks). Come back tomorrow — we keep this free for everyone!`,
      status: 429,
      retryAfter,
    };
  }

  return {
    valid: true,
    installId,
    remaining: Math.min(burst.remaining, daily.remaining),
  };
}
