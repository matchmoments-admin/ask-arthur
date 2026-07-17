import { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import { createServiceClient } from "@askarthur/supabase/server";
import { EXTENSION_TIER_LIMITS } from "@askarthur/types/billing";
import { verifyExtensionSignature } from "./signature";

export type ExtensionTier = "free" | "pro";

export type ExtensionAuthResult =
  | {
      valid: true;
      installId: string;
      remaining: number;
      requestId: string | null;
      /** Resolved subscription tier (Redis-cached 5 min; fail-open free).
       *  Routes with tier-dependent behaviour (analyze-image cap) consume
       *  this instead of re-querying get_extension_tier. */
      tier: ExtensionTier;
      /** sha256(installId) hex — the only install identifier that may be
       *  persisted in evidence records (ADR-0022). Same hash the limiters
       *  key on; computed once here so consumers never re-derive it. */
      installIdHash: string;
    }
  | { valid: false; error: string; status: number; retryAfter?: string };

// Manual checks — free: 10/min burst, 50/day; pro: 30/min, 500/day
// (EXTENSION_TIER_LIMITS). Free limiters keep their original prefixes and
// values EXACTLY (askarthur:ext:burst / askarthur:ext:daily) — every live
// install is on them. Pro limiters get tier-suffixed prefixes so an upgrade
// mid-day starts a fresh bucket immediately instead of inheriting the
// exhausted free one.
let _burstLimiter: Ratelimit | null = null;
let _dailyLimiter: Ratelimit | null = null;
let _proBurstLimiter: Ratelimit | null = null;
let _proDailyLimiter: Ratelimit | null = null;

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

function getProBurstLimiter() {
  if (!_proBurstLimiter) {
    _proBurstLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(
        EXTENSION_TIER_LIMITS.pro.burstPerMinute,
        "1 m",
      ),
      prefix: "askarthur:ext:burst:pro",
    });
  }
  return _proBurstLimiter;
}

function getProDailyLimiter() {
  if (!_proDailyLimiter) {
    _proDailyLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(
        EXTENSION_TIER_LIMITS.pro.dailyChecks,
        "24 h",
      ),
      prefix: "askarthur:ext:daily:pro",
    });
  }
  return _proDailyLimiter;
}

const TIER_CACHE_PREFIX = "askarthur:ext:tier:";
const TIER_CACHE_TTL_SECONDS = 300;

/**
 * Resolve the install's tier, Redis-cached for 5 minutes (keyed on the same
 * hashed install id as the limiters). Fail-open to FREE on any error: a
 * paying user briefly degraded to free limits beats a free user granted pro
 * limits, and beats failing the request outright.
 */
async function resolveTier(
  identifier: string,
  installId: string,
): Promise<ExtensionTier> {
  const cacheKey = `${TIER_CACHE_PREFIX}${identifier}`;
  try {
    const cached = await getRedis().get<string>(cacheKey);
    if (cached === "pro" || cached === "free") return cached;
  } catch {
    // Cache miss path below.
  }

  let tier: ExtensionTier = "free";
  try {
    const supabase = createServiceClient();
    if (supabase) {
      const { data } = await supabase.rpc("get_extension_tier", {
        p_install_id: installId,
      });
      if (data === "pro") tier = "pro";
    }
  } catch {
    tier = "free";
  }

  try {
    await getRedis().set(cacheKey, tier, { ex: TIER_CACHE_TTL_SECONDS });
  } catch {
    // Best-effort cache.
  }
  return tier;
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

  // Hashed install id — limiter key AND the only persistable install
  // identifier (ADR-0022). Computed once, exposed on the result.
  const data = new TextEncoder().encode(installId);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  const identifier = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (!process.env.UPSTASH_REDIS_REST_URL) {
    if (process.env.NODE_ENV === "production") {
      logger.error("UPSTASH_REDIS_REST_URL not set in production — blocking");
      return { valid: false, error: "Service unavailable", status: 503 };
    }
    return {
      valid: true,
      installId,
      remaining: 99,
      requestId,
      tier: "free",
      installIdHash: identifier,
    };
  }

  const scanSource = req.headers.get("x-scan-source");
  const isEmailScan = scanSource === "email";

  const tier = await resolveTier(identifier, installId);
  const isPro = tier === "pro";

  // Email scans keep their own flat limits (20/min, 200/day) regardless of
  // tier — that budget was sized for auto-scanning volume, not plan value.
  const burstLimiter = isEmailScan
    ? getEmailBurstLimiter()
    : isPro
      ? getProBurstLimiter()
      : getBurstLimiter();
  const dailyLimiter = isEmailScan
    ? getEmailDailyLimiter()
    : isPro
      ? getProDailyLimiter()
      : getDailyLimiter();
  const dailyLimit = isEmailScan
    ? 200
    : EXTENSION_TIER_LIMITS[tier].dailyChecks;

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
      error: isPro
        ? `Daily limit reached (${dailyLimit} checks). Resets tomorrow.`
        : `Daily limit reached (${dailyLimit} checks). Come back tomorrow — we keep this free for everyone!`,
      status: 429,
      retryAfter,
    };
  }

  return {
    valid: true,
    installId,
    remaining: Math.min(burst.remaining, daily.remaining),
    requestId,
    tier,
    installIdHash: identifier,
  };
}
