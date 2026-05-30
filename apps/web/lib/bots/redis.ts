import { Redis } from "@upstash/redis";

// Shared Upstash client for the bot surface. Lives in its own neutral module
// (rather than a feature-named one) because three unrelated bot features depend
// on it: replay dedup (replay-dedup.ts) and the messenger/whatsapp first-time
// AI-disclosure tracking. `@upstash/redis` is a stateless REST client, so a
// single module-level singleton is safe and strictly better than the three
// byte-identical per-handler clients this replaced.

let _redis: Redis | null = null;

/**
 * Lazy memoised Upstash client. Returns null when the env isn't configured so
 * callers degrade gracefully (the bot features that use it are non-critical:
 * dedup fails open, disclosure tracking simply doesn't fire).
 */
export function getBotRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}
