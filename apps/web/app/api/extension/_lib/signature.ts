import { NextRequest } from "next/server";
import { Redis } from "@upstash/redis";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export type SignatureResult =
  | { ok: true; installId: string }
  | { ok: false; reason: string; status: number };

export interface ExtensionPublicKey {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
}

const CLOCK_SKEW_SECONDS = 5 * 60;
const NONCE_TTL_SECONDS = 10 * 60;
const PUBKEY_CACHE_TTL_SECONDS = 5 * 60;

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (_redis) return _redis;
  if (!process.env.UPSTASH_REDIS_REST_URL) return null;
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return _redis;
}

async function sha256Base64(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadPublicKey(installId: string): Promise<ExtensionPublicKey | null> {
  const redis = getRedis();
  const cacheKey = `askarthur:ext:pk:${installId}`;

  if (redis) {
    const cached = await redis.get<ExtensionPublicKey | "missing">(cacheKey);
    if (cached === "missing") return null;
    if (cached) return cached;
  }

  const supabase = createServiceClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("extension_installs")
    .select("public_key_jwk, revoked")
    .eq("install_id", installId)
    .maybeSingle();

  if (error) {
    logger.error("Failed to load extension public key", { error, installId });
    return null;
  }

  if (!data || data.revoked) {
    if (redis) await redis.set(cacheKey, "missing", { ex: 60 });
    return null;
  }

  const jwk = data.public_key_jwk as ExtensionPublicKey;
  if (redis) await redis.set(cacheKey, jwk, { ex: PUBKEY_CACHE_TTL_SECONDS });
  return jwk;
}

export async function invalidatePublicKeyCache(installId: string): Promise<void> {
  const redis = getRedis();
  if (redis) await redis.del(`askarthur:ext:pk:${installId}`);
}

async function readBody(req: NextRequest): Promise<string> {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return "";
  try {
    return await req.clone().text();
  } catch {
    return "";
  }
}

export async function verifyExtensionSignature(
  req: NextRequest
): Promise<SignatureResult> {
  const installId = req.headers.get("x-extension-install-id");
  const timestampStr = req.headers.get("x-extension-timestamp");
  const nonce = req.headers.get("x-extension-nonce");
  const signatureB64 = req.headers.get("x-extension-signature");

  if (!installId || !timestampStr || !nonce || !signatureB64) {
    return { ok: false, reason: "Missing signature headers", status: 401 };
  }
  if (installId.length < 10 || installId.length > 64) {
    return { ok: false, reason: "Invalid install id", status: 400 };
  }
  if (nonce.length < 8 || nonce.length > 128) {
    return { ok: false, reason: "Invalid nonce", status: 400 };
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: "Invalid timestamp", status: 400 };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "Timestamp outside skew window", status: 401 };
  }

  // Replay protection — SETNX on nonce
  const redis = getRedis();
  if (redis) {
    const nonceKey = `askarthur:ext:nonce:${installId}:${nonce}`;
    const set = await redis.set(nonceKey, 1, { ex: NONCE_TTL_SECONDS, nx: true });
    if (set === null) {
      return { ok: false, reason: "Nonce replay", status: 401 };
    }
  }

  const jwk = await loadPublicKey(installId);
  if (!jwk) {
    return { ok: false, reason: "Unknown install id", status: 401 };
  }

  const method = req.method.toUpperCase();
  const path = new URL(req.url).pathname;
  const body = await readBody(req);
  const bodyHash = await sha256Base64(body);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (err) {
    logger.error("Failed to import extension public key", { error: err, installId });
    return { ok: false, reason: "Key import failed", status: 500 };
  }

  let signatureBytes: Uint8Array<ArrayBuffer>;
  try {
    signatureBytes = base64UrlToBytes(signatureB64);
  } catch {
    return { ok: false, reason: "Malformed signature", status: 400 };
  }

  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signatureBytes.buffer.slice(
      signatureBytes.byteOffset,
      signatureBytes.byteOffset + signatureBytes.byteLength
    ),
    new TextEncoder().encode(canonical)
  );

  if (!verified) {
    return { ok: false, reason: "Signature verification failed", status: 401 };
  }

  return { ok: true, installId };
}

export async function touchLastSeen(installId: string): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;
  await supabase
    .from("extension_installs")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("install_id", installId);
}
