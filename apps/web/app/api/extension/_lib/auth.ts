import { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import { verifyExtensionSignature } from "./signature";

export type ExtensionAuthResult =
  | {
      valid: true;
      installId: string;
      remaining: number;
      requestId: string | null;
    }
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

export async function validateExtensionRequest(
  req: NextRequest
): Promise<ExtensionAuthResult> {
  const requestId = req.headers.get("x-request-id");
  if (requestId) {
    logger.info("Extension request", { requestId });
  }

  const sig = await verifyExtensionSignature(req);
  if (!sig.ok) {
    return { valid: false, error: sig.reason, status: sig.status };
  }
  const installId = sig.installId;

  // Rate limit on hashed installation ID
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    if (process.env.NODE_ENV === "production") {
      logger.error("UPSTASH_REDIS_REST_URL not set in production — blocking");
      return { valid: false, error: "Service unavailable", status: 503 };
    }
    return { valid: true, installId, remaining: 99, requestId };
  }

  const data = new TextEncoder().encode(installId);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const identifier = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const scanSource = req.headers.get("x-scan-source");
  const isEmailScan = scanSource === "email";

  const burstLimiter = isEmailScan ? getEmailBurstLimiter() : getBurstLimiter();
  const dailyLimiter = isEmailScan ? getEmailDailyLimiter() : getDailyLimiter();
  const dailyLimit = isEmailScan ? 200 : 50;

  const burst = await burstLimiter.limit(identifier);
  if (!burst.success) {
    const retryAfter = String(Math.ceil((burst.reset - Date.now()) / 1000));
    return {
      valid: false,
      error: "Too many requests. Please slow down.",
      status: 429,
      retryAfter,
    };
  }

  const daily = await dailyLimiter.limit(identifier);
  if (!daily.success) {
    const retryAfter = String(Math.ceil((daily.reset - Date.now()) / 1000));
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
    requestId,
  };
}
