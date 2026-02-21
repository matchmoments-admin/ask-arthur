import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";

export interface ApiKeyValidation {
  valid: boolean;
  orgName?: string;
  tier?: string;
  dailyRemaining?: number;
  rateLimited?: boolean;
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

export async function validateApiKey(
  req: NextRequest
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
    .select("org_name, tier, is_active, daily_limit")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data || !data.is_active) {
    return { valid: false };
  }

  // Check daily rate limit
  const dailyLimit = data.daily_limit ?? 100;
  const { allowed, remaining } = await checkDailyLimit(keyHash, dailyLimit);

  if (!allowed) {
    return {
      valid: true,
      orgName: data.org_name,
      tier: data.tier,
      dailyRemaining: 0,
      rateLimited: true,
    };
  }

  // Update last_used_at (fire-and-forget)
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("key_hash", keyHash)
    .then(() => {});

  return {
    valid: true,
    orgName: data.org_name,
    tier: data.tier,
    dailyRemaining: remaining,
  };
}
