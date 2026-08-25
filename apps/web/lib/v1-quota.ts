// Monthly quota metering for v1 endpoints — the shared idiom beside
// apiAuth's per-day/minute counters, so allowances are visible in
// /api/v1/usage rather than living in a route-private Redis key.
//
// Semantics (2026-08-22 review of PR #1031 shaped all four):
// - The allowance is PER ORGANISATION (callers pass an orgId scope) — unlike
//   the per-key daily/minute limits. Two keys on one org share the meter;
//   this is billing identity, not abuse control.
// - Consume ONLY after request validation — a malformed upload must never
//   burn a paid unit (no DECR/refund exists).
// - incr and expire are isolated: an expire failure never converts a
//   consumed unit into an error response, and the TTL is asserted with NX
//   on every call so a missed first-call expire can't leave the key
//   immortal in Upstash.
// - Fail posture matches the platform rate-limit convention: CLOSED in
//   prod (quota is a rate-limit-class control), OPEN elsewhere so local
//   dev works without Upstash env.
// - Buckets are calendar months in UTC — resets at 00:00 UTC on the 1st
//   (10/11am AEST), documented here so support isn't surprised.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

const failsClosed = (): boolean => process.env.VERCEL_ENV === "production";

const TTL_SECONDS = 60 * 60 * 24 * 40;

function monthKey(feature: string, scope: string): string {
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM, UTC
  return `askarthur:quota:${feature}:${scope}:${month}`;
}

/** Seconds until the UTC month rolls over — Retry-After for quota 429s. */
export function secondsToMonthEnd(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

export type MonthlyQuotaResult =
  | { allowed: true; used: number; remaining: number }
  | { allowed: false; reason: "exceeded"; used: number; remaining: 0 }
  | { allowed: false; reason: "store_unavailable" };

/** Consume one unit of a calendar-month allowance. Call AFTER validating
 *  the request — consumption is not refundable. */
export async function consumeMonthlyQuota(
  feature: string,
  scope: string,
  limit: number,
): Promise<MonthlyQuotaResult> {
  const redis = getRedis();
  if (!redis) {
    if (failsClosed()) return { allowed: false, reason: "store_unavailable" };
    return { allowed: true, used: 0, remaining: limit };
  }
  const key = monthKey(feature, scope);
  let count: number;
  try {
    count = await redis.incr(key);
  } catch (err) {
    logger.error("consumeMonthlyQuota: incr unavailable", {
      feature,
      error: String(err),
    });
    if (failsClosed()) return { allowed: false, reason: "store_unavailable" };
    return { allowed: true, used: 0, remaining: limit };
  }
  try {
    // NX: assert the TTL every call so a missed first-call expire can't
    // strand an immortal key; never let this failure surface to the caller.
    await redis.expire(key, TTL_SECONDS, "NX");
  } catch {
    // unit already consumed and counted — a TTL hiccup is not an error
  }
  if (count > limit) {
    return { allowed: false, reason: "exceeded", used: count, remaining: 0 };
  }
  return { allowed: true, used: count, remaining: Math.max(0, limit - count) };
}

/** Read the month's usage without consuming — for /api/v1/usage. */
export async function peekMonthlyQuota(
  feature: string,
  scope: string,
  limit: number,
): Promise<{ used: number; remaining: number } | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const used = Number((await redis.get(monthKey(feature, scope))) ?? 0);
    return { used, remaining: Math.max(0, limit - used) };
  } catch {
    return null;
  }
}
