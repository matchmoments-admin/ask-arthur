import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

// Bot platforms (Telegram, Meta) retry a webhook delivery whenever the
// endpoint is slow or returns non-2xx. Because every inbound message kicks off
// a paid Claude analysis, an un-deduplicated retry storm — or a replayed
// capture of a signature-valid payload — means duplicate analyses (cost) and
// duplicate replies to the user. This module records each (platform, message-id)
// in Redis with a TTL well past any platform's retry window, so a re-delivery
// of the same id is recognised and skipped.

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

// 6 hours — comfortably longer than Telegram's ~24h-but-backoff retry curve
// settles and Meta's minutes-long retry window, while bounding key growth.
const DEDUP_TTL_SECONDS = 6 * 60 * 60;

/**
 * Returns true if this (platform, id) has already been processed (a retry /
 * replay), false if it is new — in which case it is atomically recorded via a
 * `SET … NX` so a concurrent re-delivery can't both win.
 *
 * Fail-OPEN: if Redis is absent or errors, returns false so genuine messages
 * still get processed. Webhooks are already HMAC/secret-verified upstream, so
 * dedup is cost/duplicate-reply defence-in-depth, not the security boundary —
 * failing closed here would silently drop real user messages during a Redis
 * blip, which is the worse failure mode.
 */
export async function isReplay(
  platform: string,
  id: string | number | undefined | null,
): Promise<boolean> {
  if (id === undefined || id === null || id === "") return false;
  const redis = getRedis();
  if (!redis) return false;
  try {
    const key = `botdedup:${platform}:${id}`;
    // SET NX returns "OK" when newly set, null when the key already existed.
    const set = await redis.set(key, "1", { nx: true, ex: DEDUP_TTL_SECONDS });
    if (set === null) {
      logger.info("Bot webhook replay suppressed", { platform, id: String(id) });
      return true;
    }
    return false;
  } catch (err) {
    logger.warn("Bot replay-dedup check failed (fail-open)", {
      platform,
      error: String(err),
    });
    return false;
  }
}
