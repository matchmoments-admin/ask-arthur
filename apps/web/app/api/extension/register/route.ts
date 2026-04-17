import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { verifyTurnstileToken } from "../_lib/turnstile";
import { invalidatePublicKeyCache } from "../_lib/signature";

const JwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: z.string().min(1).max(128),
  y: z.string().min(1).max(128),
  ext: z.boolean().optional(),
  key_ops: z.array(z.string()).optional(),
  use: z.string().optional(),
  alg: z.string().optional(),
});

const RegisterSchema = z.object({
  installId: z.string().uuid(),
  publicKeyJwk: JwkSchema,
  turnstileToken: z.string().min(10).max(4096),
});

let _ipLimiter: Ratelimit | null = null;
function getIpLimiter(): Ratelimit | null {
  if (_ipLimiter) return _ipLimiter;
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  _ipLimiter = new Ratelimit({
    redis: new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }),
    limiter: Ratelimit.slidingWindow(5, "1 h"),
    prefix: "askarthur:ext:register",
  });
  return _ipLimiter;
}

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(req: NextRequest) {
  try {
    const ip = getIp(req);

    const limiter = getIpLimiter();
    if (limiter) {
      const { success, reset } = await limiter.limit(ip);
      if (!success) {
        const retryAfter = String(Math.ceil((reset - Date.now()) / 1000));
        return NextResponse.json(
          { error: "Too many registrations" },
          { status: 429, headers: { "Retry-After": retryAfter } }
        );
      }
    }

    const body = await req.json().catch(() => null);
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }

    const { installId, publicKeyJwk, turnstileToken } = parsed.data;

    const turnstile = await verifyTurnstileToken(turnstileToken, ip);
    if (!turnstile.success) {
      logger.warn("Turnstile verification failed", {
        installId,
        errorCodes: turnstile.errorCodes,
      });
      return NextResponse.json({ error: "Bot check failed" }, { status: 401 });
    }

    try {
      await crypto.subtle.importKey(
        "jwk",
        publicKeyJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"]
      );
    } catch {
      return NextResponse.json({ error: "Invalid public key" }, { status: 400 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      logger.error("Supabase unavailable for extension register");
      return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    }

    const ipHash = await sha256Hex(ip);

    const { error } = await supabase
      .from("extension_installs")
      .upsert(
        {
          install_id: installId,
          public_key_jwk: publicKeyJwk,
          registered_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          revoked: false,
          revoked_reason: null,
          ip_hash: ipHash,
          turnstile_country: turnstile.country ?? null,
        },
        { onConflict: "install_id" }
      );

    if (error) {
      logger.error("Failed to upsert extension install", { error, installId });
      return NextResponse.json({ error: "Registration failed" }, { status: 500 });
    }

    await invalidatePublicKeyCache(installId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("Extension register error", { error: err });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
