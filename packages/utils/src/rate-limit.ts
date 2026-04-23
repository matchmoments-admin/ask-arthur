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

// =============================================================================
// Phone Footprint — dedicated buckets
// =============================================================================
// Buckets are separate from the generic burst/daily limiters because the
// Phone Footprint product has stricter per-tier rules and its own cost
// exposure (Twilio Verify ~$0.10/OTP, Vonage NI ~$0.04, LeakCheck ~$0.002).
// Abuse on these routes burns real money, so every bucket defaults to
// fail-closed in production (see defaultFailMode).

type PfBucket =
  | "anon_burst"        // teaser lookup, unauthenticated
  | "anon_daily"        // teaser lookup, unauthenticated — outer cap
  | "user"              // authenticated paid lookup
  | "verify_otp_phone"  // OTP send attempts per phone number
  | "verify_otp_ip"     // OTP send attempts per IP
  | "org_fleet_bulk"    // CSV bulk upload per org
  | "msisdn_cross_ip"   // enumeration detection: N distinct IPs per msisdn
  | "pdf_render";       // expensive PDF generation

const _pfLimiters = new Map<PfBucket, Ratelimit>();

function getPfLimiter(bucket: PfBucket): Ratelimit {
  const existing = _pfLimiters.get(bucket);
  if (existing) return existing;

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  // Per-bucket configuration. Window shapes chosen to match the abuse model
  // described in docs/plans/phone-footprint-v2.md §9:
  //   anon_burst: 3/hr (sliding) — covers legitimate "check my number" use
  //   anon_daily: 10/day — outer safety cap for teaser
  //   user: 60/min — plenty of headroom for UI autocompletion
  //   verify_otp_phone: 3/day per phone — hard ceiling on OTP cost exposure
  //   verify_otp_ip: 10/day per IP — bot throttle
  //   org_fleet_bulk: 3/hr per org — CSV upload cadence
  //   msisdn_cross_ip: 3/24h distinct-IP count per msisdn_hash — stalker /
  //     enumeration defence. Exceed → route forces teaser-only for 24h.
  //   pdf_render: 5/day per user — R2 egress + memory cap.
  const slidingWindow = Ratelimit.slidingWindow.bind(Ratelimit);
  const config: Record<
    PfBucket,
    { algo: ReturnType<typeof slidingWindow>; prefix: string }
  > = {
    anon_burst:       { algo: slidingWindow(3,  "1 h"),  prefix: "askarthur:pf:anon:burst" },
    anon_daily:       { algo: slidingWindow(10, "24 h"), prefix: "askarthur:pf:anon:daily" },
    user:             { algo: slidingWindow(60, "1 m"),  prefix: "askarthur:pf:user" },
    verify_otp_phone: { algo: slidingWindow(3,  "24 h"), prefix: "askarthur:pf:otp:phone" },
    verify_otp_ip:    { algo: slidingWindow(10, "24 h"), prefix: "askarthur:pf:otp:ip" },
    org_fleet_bulk:   { algo: slidingWindow(3,  "1 h"),  prefix: "askarthur:pf:fleet:bulk" },
    msisdn_cross_ip:  { algo: slidingWindow(3,  "24 h"), prefix: "askarthur:pf:xip" },
    pdf_render:       { algo: slidingWindow(5,  "24 h"), prefix: "askarthur:pf:pdf" },
  };

  const lim = new Ratelimit({
    redis,
    limiter: config[bucket].algo,
    prefix: config[bucket].prefix,
    analytics: true,
  });
  _pfLimiters.set(bucket, lim);
  return lim;
}

/**
 * Check a Phone Footprint rate-limit bucket.
 *
 * All Phone Footprint routes default to fail-closed in production — a Redis
 * outage must NOT open the floodgates on Twilio Verify or Vonage spend. In
 * development, fail-open for local iteration without Redis.
 */
export async function checkPhoneFootprintRateLimit(
  bucket: PfBucket,
  identifier: string,
  failMode: FailMode = defaultFailMode(),
): Promise<RateLimitResult> {
  if (!process.env.UPSTASH_REDIS_REST_URL) {
    return storeUnavailable(failMode, `checkPhoneFootprintRateLimit:${bucket}`);
  }
  try {
    const res = await getPfLimiter(bucket).limit(identifier);
    if (!res.success) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(res.reset),
        message: "Too many requests. Please try again later.",
      };
    }
    return {
      allowed: true,
      remaining: res.remaining,
      resetAt: null,
    };
  } catch (err) {
    logger.error(`checkPhoneFootprintRateLimit:${bucket}: store error`, { error: String(err) });
    return storeUnavailable(failMode, `checkPhoneFootprintRateLimit:${bucket}`);
  }
}
