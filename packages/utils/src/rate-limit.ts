import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logger } from "./logger";
import { hashIdentifier } from "./hash";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
  message?: string;
  /**
   * Why this result was returned.
   *
   * - "ok": below quota, request allowed.
   * - "exceeded": user genuinely hit their quota. Caller should tell the
   *   user (polite reply, friendly UI) — silent drops here destroy trust.
   * - "store_unavailable": Upstash Redis was unreachable / threw. Caller
   *   decides whether to fail open (cheap operations) or closed (paid
   *   operations); either way this should page an operator, not silently
   *   drop the request.
   *
   * Existed-only-as-`allowed` previously, which collapsed the two failure
   * modes into one and made `route.ts` apologise to the user for an
   * infrastructure blip as if they'd hit their quota. Incident
   * 2026-05-18 (jacobovers@gmail.com): scan emails silently dropped
   * because callers could not distinguish "user used 3 today" from
   * "Anthropic returned 529".
   */
  reason?: "ok" | "exceeded" | "store_unavailable";
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
      reason: "store_unavailable",
    };
  }
  logger.error(`${label}: store unavailable — failing OPEN`);
  return {
    allowed: true,
    remaining: 99,
    resetAt: null,
    reason: "store_unavailable",
  };
}

// =============================================================================
// The limiter factory — the ONE place a bucket's Upstash wiring, key shape,
// result shaping and fail-mode handling live. Every exported check below is a
// declaration (prefix / limit / window / message) through `defineLimiter`.
// Before this factory each bucket hand-copied the same ~40 lines (lazy Redis,
// env guard, try/catch, result objects); the copies are pinned, byte-for-byte
// in behaviour, by __tests__/rate-limit-pinned.test.ts.
// =============================================================================

type Window = Parameters<typeof Ratelimit.slidingWindow>[1];

export interface LimiterSpec {
  /** Upstash key prefix — changing it resets every user's quota. */
  prefix: string;
  /** Sliding-window size: `limit` requests per `window`. */
  limit: number;
  window: Window;
  /** User-facing text on the exceeded result. */
  message: string;
  /** Log label for store errors / fail-mode decisions. */
  label: string;
  analytics?: boolean;
  /** Upstash request timeout (ms). */
  timeout?: number;
  /** Map the caller's identifier to the Redis key (normalise, hash, prefix). */
  key?: (id: string) => string | Promise<string>;
  /** Set `reason` on ok/exceeded results too. Limiters written before the
   *  `reason` field existed leave it off; kept per-limiter so the refactor
   *  changed no result shape. */
  reasonOnDecision?: boolean;
  /** "env" (default): closed in production, open in dev. A fixed mode also
   *  ignores any mode the caller passes. */
  failModeDefault?: "env" | FailMode;
}

export type LimiterCheck = (
  id: string,
  failMode?: FailMode,
) => Promise<RateLimitResult>;

/** A lazily-constructed Upstash sliding-window limiter (one per bucket). */
function lazyRatelimit(
  spec: Pick<LimiterSpec, "prefix" | "limit" | "window" | "analytics" | "timeout">,
): () => Ratelimit {
  let instance: Ratelimit | null = null;
  return () => {
    if (!instance) {
      instance = new Ratelimit({
        redis: new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL!,
          token: process.env.UPSTASH_REDIS_REST_TOKEN!,
        }),
        limiter: Ratelimit.slidingWindow(spec.limit, spec.window),
        prefix: spec.prefix,
        ...(spec.analytics !== undefined ? { analytics: spec.analytics } : {}),
        ...(spec.timeout !== undefined ? { timeout: spec.timeout } : {}),
      });
    }
    return instance;
  };
}

export function defineLimiter(spec: LimiterSpec): LimiterCheck {
  const get = lazyRatelimit(spec);
  const fixedMode =
    spec.failModeDefault && spec.failModeDefault !== "env"
      ? spec.failModeDefault
      : null;
  const reason = <R extends "ok" | "exceeded">(r: R) =>
    spec.reasonOnDecision ? { reason: r } : {};

  return async (id, failMode) => {
    const mode = fixedMode ?? failMode ?? defaultFailMode();
    if (!process.env.UPSTASH_REDIS_REST_URL) {
      return storeUnavailable(mode, spec.label);
    }
    const key = spec.key ? await spec.key(id) : id;
    try {
      const res = await get().limit(key);
      if (!res.success) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: new Date(res.reset),
          message: spec.message,
          ...reason("exceeded"),
        };
      }
      return {
        allowed: true,
        remaining: res.remaining,
        resetAt: null,
        ...reason("ok"),
      };
    } catch (err) {
      logger.error(`${spec.label}: store error`, { error: String(err) });
      return storeUnavailable(mode, spec.label);
    }
  };
}

/** Declare a family of buckets sharing one check function (label
 *  `<fnName>:<bucket>`). */
function defineBuckets<B extends string>(
  fnName: string,
  shared: Omit<LimiterSpec, "prefix" | "limit" | "window" | "label">,
  buckets: Record<B, { prefix: string; limit: number; window: Window }>,
): Record<B, LimiterCheck> {
  const out = {} as Record<B, LimiterCheck>;
  for (const b of Object.keys(buckets) as B[]) {
    out[b] = defineLimiter({ ...shared, ...buckets[b], label: `${fnName}:${b}` });
  }
  return out;
}

// =============================================================================
// Web checker — two-tier (burst 3/h, then daily 10/24h) on a hashed IP+UA.
// Doesn't fit a single defineLimiter (two windows, tier-specific messages,
// min-remaining across tiers); it reuses the factory's lazy constructor.
// =============================================================================

const getBurstLimiter = lazyRatelimit({ prefix: "askarthur:burst", limit: 3, window: "1 h" });
const getDailyLimiter = lazyRatelimit({ prefix: "askarthur:daily", limit: 10, window: "24 h" });

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

// =============================================================================
// Single-bucket limiters
// =============================================================================

/** Free document checks per IP per hour. Exported so user-facing copy can
 *  state the real number instead of hardcoding one that silently drifts
 *  from the limiter. */
export const DOCUMENT_UPLOAD_LIMIT_PER_HOUR = 5;

/** Image vision calls cost ~$0.002-$0.01 each — the cost of a miss (unbounded
 *  Anthropic spend) far exceeds a rare false block during a Redis blip. */
const imageUpload = defineLimiter({
  label: "checkImageUploadRateLimit",
  prefix: "askarthur:image-upload",
  limit: 5,
  window: "1 h",
  analytics: true,
  timeout: 1000,
  key: (ip) => `ip:${ip}`,
  message: "Too many image uploads. Try again later.",
});
export const checkImageUploadRateLimit = (ip: string, failMode?: FailMode) =>
  imageUpload(ip, failMode);

/** Document forensics is CPU-only (no paid API) but accepts 10 MB anonymous
 *  uploads — the limit bounds bandwidth/compute abuse. */
const documentUpload = defineLimiter({
  label: "checkDocumentUploadRateLimit",
  prefix: "askarthur:doc-upload",
  limit: DOCUMENT_UPLOAD_LIMIT_PER_HOUR,
  window: "1 h",
  analytics: true,
  timeout: 1000,
  key: (ip) => `ip:${ip}`,
  message: "Too many document checks. Try again later.",
});
export const checkDocumentUploadRateLimit = (ip: string, failMode?: FailMode) =>
  documentUpload(ip, failMode);

/** Audio deepfake checks call a paid vendor per request — same
 *  fail-closed-in-prod posture as the other paid upload paths. */
export const DEEPFAKE_LIMIT_PER_HOUR = 10;

const deepfake = defineLimiter({
  label: "checkDeepfakeRateLimit",
  prefix: "askarthur:deepfake",
  limit: DEEPFAKE_LIMIT_PER_HOUR,
  window: "1 h",
  analytics: true,
  timeout: 1000,
  key: (ip) => `ip:${ip}`,
  message: "Too many audio checks. Try again later.",
});
export const checkDeepfakeRateLimit = (ip: string, failMode?: FailMode) =>
  deepfake(ip, failMode);

const form = defineLimiter({
  label: "checkFormRateLimit",
  prefix: "askarthur:form",
  limit: 5,
  window: "1 h",
  message: "Too many submissions. Please try again later.",
});
export const checkFormRateLimit = (ip: string, failMode?: FailMode) =>
  form(ip, failMode);

// =============================================================================
// Phone Footprint — dedicated buckets (MOTHBALLED product; kept wired).
// Separate from the generic limiters because of per-tier rules and real cost
// exposure (Twilio Verify ~$0.10/OTP, Vonage NI ~$0.04, LeakCheck ~$0.002).
// Windows per docs/plans/phone-footprint-v2.md §9:
//   anon_burst 3/h + anon_daily 10/day (teaser), user 60/min, verify_otp_phone
//   3/day per phone (OTP cost ceiling), verify_otp_ip 10/day per IP,
//   org_fleet_bulk 3/h per org, msisdn_cross_ip 3/24h distinct-IP count per
//   msisdn_hash (stalker/enumeration defence), pdf_render 5/day per user.
// =============================================================================

const phoneFootprint = defineBuckets(
  "checkPhoneFootprintRateLimit",
  { analytics: true, message: "Too many requests. Please try again later." },
  {
    anon_burst:       { prefix: "askarthur:pf:anon:burst", limit: 3,  window: "1 h" },
    anon_daily:       { prefix: "askarthur:pf:anon:daily", limit: 10, window: "24 h" },
    user:             { prefix: "askarthur:pf:user",       limit: 60, window: "1 m" },
    verify_otp_phone: { prefix: "askarthur:pf:otp:phone",  limit: 3,  window: "24 h" },
    verify_otp_ip:    { prefix: "askarthur:pf:otp:ip",     limit: 10, window: "24 h" },
    org_fleet_bulk:   { prefix: "askarthur:pf:fleet:bulk", limit: 3,  window: "1 h" },
    msisdn_cross_ip:  { prefix: "askarthur:pf:xip",        limit: 3,  window: "24 h" },
    pdf_render:       { prefix: "askarthur:pf:pdf",        limit: 5,  window: "24 h" },
  },
);
type PfBucket = keyof typeof phoneFootprint;

/** Phone Footprint bucket check; fail-closed in production — a Redis outage
 *  must NOT open the floodgates on Twilio Verify or Vonage spend. */
export const checkPhoneFootprintRateLimit = (
  bucket: PfBucket,
  identifier: string,
  failMode?: FailMode,
) => phoneFootprint[bucket](identifier, failMode);

// =============================================================================
// Breach Defence — dedicated buckets (MOTHBALLED product; kept wired).
//   bd_lookup 5/h/IP (consumer email/phone/ID hash search, HIBP-style polite
//   cap), bd_extension 60/min/IP (chatty content script), bd_b2b 30/min/key
//   (identifier is the API key hash; validateApiKey adds a daily cap on top).
// =============================================================================

const breachDefence = defineBuckets(
  "checkBreachDefenceRateLimit",
  { analytics: true, message: "Too many requests. Please try again later." },
  {
    bd_lookup:    { prefix: "askarthur:bd:lookup", limit: 5,  window: "1 h" },
    bd_extension: { prefix: "askarthur:bd:ext",    limit: 60, window: "1 m" },
    bd_b2b:       { prefix: "askarthur:bd:b2b",    limit: 30, window: "1 m" },
  },
);
type BdBucket = keyof typeof breachDefence;

/** Breach Defence bucket check; fail-closed in production (bd_lookup is a
 *  privacy-sensitive surface). */
export const checkBreachDefenceRateLimit = (
  bucket: BdBucket,
  identifier: string,
  failMode?: FailMode,
) => breachDefence[bucket](identifier, failMode);

// =============================================================================
// Charity Check — cc_lookup 5/h/IP (the only ABR caller — caps third-party
// exposure), cc_autocomplete 60/min/IP (typeahead over a local RPC).
// =============================================================================

const charityCheck = defineBuckets(
  "checkCharityCheckRateLimit",
  { analytics: true, message: "Too many requests. Please try again later." },
  {
    cc_lookup:       { prefix: "askarthur:cc:lookup",       limit: 5,  window: "1 h" },
    cc_autocomplete: { prefix: "askarthur:cc:autocomplete", limit: 60, window: "1 m" },
  },
);
type CcBucket = keyof typeof charityCheck;

/** Charity Check bucket check; fail-closed in production (unbounded ABR
 *  calls during a Redis blip would be free credential-stuffing of a paid
 *  third-party endpoint). */
export const checkCharityCheckRateLimit = (
  bucket: CcBucket,
  identifier: string,
  failMode?: FailMode,
) => charityCheck[bucket](identifier, failMode);

// =============================================================================
// Shop Signal — sc_deep_check 5/10min/IP (spends APIVoid credits + a
// whoisjson free-tier call; fail-closed), sc_poll 120/min/IP (the tray polls
// every 2s for ≤60s → ≈30 GETs/min legit; the GET route passes "open").
// =============================================================================

const shopSignal = defineBuckets(
  "checkShopSignalRateLimit",
  {
    analytics: true,
    reasonOnDecision: true,
    message: "Too many shop checks. Please try again later.",
  },
  {
    sc_deep_check: { prefix: "askarthur:shop:deep-check", limit: 5,   window: "10 m" },
    sc_poll:       { prefix: "askarthur:shop:poll",       limit: 120, window: "1 m" },
  },
);
type ShopSignalBucket = keyof typeof shopSignal;

export const checkShopSignalRateLimit = (
  bucket: ShopSignalBucket,
  identifier: string,
  failMode?: FailMode,
) => shopSignal[bucket](identifier, failMode);

// =============================================================================
// Org invites
// =============================================================================

/** Accept attempts per authenticated user: 10/h — pairs with the route's
 *  email-binding check so token guessing/enumeration is impractical. */
const orgInviteAccept = defineLimiter({
  label: "checkOrgInviteAcceptRateLimit",
  prefix: "askarthur:org-invite-accept",
  limit: 10,
  window: "1 h",
  analytics: true,
  reasonOnDecision: true,
  message: "Too many invite-accept attempts. Try again later.",
});
export const checkOrgInviteAcceptRateLimit = (userId: string, failMode?: FailMode) =>
  orgInviteAccept(userId, failMode);

/** Invite sends per inviter: 20/24h — each call emails from the Ask Arthur
 *  sender, so it is bounded like any other outbound send. */
const orgInviteSend = defineLimiter({
  label: "checkOrgInviteSendRateLimit",
  prefix: "askarthur:org-invite-send",
  limit: 20,
  window: "24 h",
  analytics: true,
  reasonOnDecision: true,
  message: "Too many invitations sent. Try again later.",
});
export const checkOrgInviteSendRateLimit = (userId: string, failMode?: FailMode) =>
  orgInviteSend(userId, failMode);

// =============================================================================
// Inbound scan (scan@) — 3 forwards / day per sender. The key strips +tags and
// lowercases so "alice+x@gmail.com" and "Alice@Gmail.com" share one quota.
// Each forward costs ~A$0.001 Claude + one Resend send; heavy users are
// pointed to the free web scanner by the 4th-message reply.
// =============================================================================

const inboundScan = defineLimiter({
  label: "checkInboundScanRateLimit",
  prefix: "askarthur:inbound-scan",
  limit: 3,
  window: "1 d",
  analytics: true,
  reasonOnDecision: true,
  key: (email) => email.trim().toLowerCase().replace(/(\+[^@]*)(@)/, "$2"),
  message:
    "You've hit today's free-forward limit (3 per day). Paste suspicious messages at askarthur.au any time — no daily cap on the web scanner.",
});
export const checkInboundScanRateLimit = (senderEmail: string, failMode?: FailMode) =>
  inboundScan(senderEmail, failMode);

// =============================================================================
// Admin triage (PR-G, #496) — 200 triage POSTs / 5 min per admin (4× a noisy
// day's bulk action; bounds a compromised token). The key is
// SHA-256(identifier, "clone-watch-triage") so no raw token lands in Redis.
// ALWAYS fail-open: a Redis outage must not lock the operator out; the
// per-brand Inngest send cap is the real downstream backstop.
// =============================================================================

const adminTriage = defineLimiter({
  label: "checkAdminTriageRateLimit",
  prefix: "askarthur:clone-watch:triage",
  limit: 200,
  window: "5 m",
  analytics: false,
  reasonOnDecision: true,
  failModeDefault: "open",
  key: (id) => hashIdentifier(id, "clone-watch-triage"),
  message: "rate_limited",
});
export const checkAdminTriageRateLimit = (adminIdentifier: string) =>
  adminTriage(adminIdentifier);
