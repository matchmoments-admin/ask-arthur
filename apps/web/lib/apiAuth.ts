import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";

export interface ApiKeyValidation {
  valid: boolean;
  orgName?: string;
  tier?: string;
  dailyRemaining?: number;
  rateLimited?: boolean;
  minuteRateLimited?: boolean;
  endpointBlocked?: boolean;
  keyHash?: string;
  maxBatchSize?: number;
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

async function checkDailyLimit(
  keyHash: string,
  dailyLimit: number
): Promise<{ allowed: boolean; remaining: number }> {
  const redis = getRedis();
  if (!redis) {
    // Fail-open in dev, fail-closed in prod
    if (process.env.NODE_ENV === "production") {
      return { allowed: false, remaining: 0 };
    }
    return { allowed: true, remaining: dailyLimit };
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const redisKey = `askarthur:apikey:${keyHash}:${today}`;

  const current = await redis.incr(redisKey);

  // Set TTL on first use (48h to cover timezone edge cases)
  if (current === 1) {
    await redis.expire(redisKey, 48 * 60 * 60);
  }

  const remaining = Math.max(0, dailyLimit - current);
  return {
    allowed: current <= dailyLimit,
    remaining,
  };
}

async function checkMinuteLimit(
  keyHash: string,
  perMinuteLimit: number
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    // Same fail-open/fail-closed pattern as daily limit
    return process.env.NODE_ENV !== "production";
  }

  const minuteKey = `askarthur:apikey:${keyHash}:rpm:${Math.floor(Date.now() / 60000)}`;
  const current = await redis.incr(minuteKey);

  if (current === 1) {
    await redis.expire(minuteKey, 120); // 2-minute TTL
  }

  return current <= perMinuteLimit;
}

/**
 * Log API usage to Supabase (fire-and-forget).
 * Uses the log_api_usage RPC to upsert per-key, per-endpoint, per-day counts.
 */
export function logApiUsage(keyHash: string, endpoint: string): void {
  const supabase = createServiceClient();
  if (!supabase) return;

  supabase
    .rpc("log_api_usage", { p_key_hash: keyHash, p_endpoint: endpoint })
    .then(() => {});
}

export async function validateApiKey(
  req: NextRequest,
  endpoint?: string
): Promise<ApiKeyValidation> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { valid: false };
  }

  const key = authHeader.slice(7);
  if (!key) return { valid: false };

  const supabase = createServiceClient();
  if (!supabase) return { valid: false };

  const keyHash = await hashKey(key);

  const { data, error } = await supabase
    .from("api_keys")
    .select(
      "org_name, tier, is_active, daily_limit, rate_limit_per_minute, max_batch_size, allowed_endpoints"
    )
    .eq("key_hash", keyHash)
    .single();

  if (error || !data || !data.is_active) {
    return { valid: false };
  }

  // Check endpoint restrictions (empty array = all endpoints allowed)
  const allowedEndpoints = data.allowed_endpoints as string[] | null;
  if (
    endpoint &&
    allowedEndpoints &&
    allowedEndpoints.length > 0 &&
    !allowedEndpoints.includes(endpoint)
  ) {
    return {
      valid: true,
      orgName: data.org_name,
      tier: data.tier,
      keyHash,
      endpointBlocked: true,
    };
  }

  // Check per-minute rate limit
  const perMinuteLimit = data.rate_limit_per_minute ?? 60;
  const minuteAllowed = await checkMinuteLimit(keyHash, perMinuteLimit);
  if (!minuteAllowed) {
    return {
      valid: true,
      orgName: data.org_name,
      tier: data.tier,
      keyHash,
      minuteRateLimited: true,
    };
  }

  // Check daily rate limit
  const dailyLimit = data.daily_limit ?? 25;
  const { allowed, remaining } = await checkDailyLimit(keyHash, dailyLimit);

  if (!allowed) {
    return {
      valid: true,
      orgName: data.org_name,
      tier: data.tier,
      dailyRemaining: 0,
      rateLimited: true,
      keyHash,
    };
  }

  // Update last_used_at (fire-and-forget)
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash)
    .then(() => {});

  // Log usage (fire-and-forget)
  if (endpoint) {
    logApiUsage(keyHash, endpoint);
  }

  return {
    valid: true,
    orgName: data.org_name,
    tier: data.tier,
    dailyRemaining: remaining,
    keyHash,
    maxBatchSize: data.max_batch_size ?? 10,
  };
}
