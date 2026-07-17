import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { validateExtensionRequest } from "../_lib/auth";
import { LINK_TOKEN_PREFIX, LINK_TOKEN_TTL_SECONDS } from "../_lib/link-token";

// Mint a short-lived, single-use link token binding "whoever holds this
// install's ECDSA private key" to a pending account-link. The token is the
// ONLY thing that crosses from extension to browser tab (via the
// /extension/link?token=... URL), so an attacker without the victim's
// private key cannot mint one for the victim's install_id — that's the whole
// defence against linking someone else's install to steal its entitlement.

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!featureFlags.extensionBilling) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Account linking is not currently enabled." },
        { status: 503 },
      );
    }

    const auth = await validateExtensionRequest(req);
    if (!auth.valid) {
      return NextResponse.json(
        { error: auth.error },
        {
          status: auth.status,
          ...(auth.retryAfter && { headers: { "Retry-After": auth.retryAfter } }),
        },
      );
    }

    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }

    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    await redis.set(`${LINK_TOKEN_PREFIX}${token}`, auth.installId, {
      ex: LINK_TOKEN_TTL_SECONDS,
    });

    return NextResponse.json(
      { token, expiresInSeconds: LINK_TOKEN_TTL_SECONDS },
      { headers: { "X-RateLimit-Remaining": String(auth.remaining) } },
    );
  } catch (err) {
    logger.error("link-token mint error", { error: String(err) });
    return NextResponse.json({ error: "link_token_failed" }, { status: 500 });
  }
}
