import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";

const COOKIE_NAME = "__aa_admin";
const MAX_AGE = 60 * 60 * 24; // 24 hours

function getSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET not configured");
  return secret;
}

/** Create an HMAC-signed token with nonce: timestamp:nonce:hmac */
export function createAdminToken(): string {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}:${nonce}`;
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return `${payload}:${hmac}`;
}

/**
 * Verify an HMAC-signed admin token with nonce.
 *
 * Observability: every failure path emits `logger.warn("admin_token_verify_failed", { reason, … })`
 * so silent rejections show up in the log stream. Each `reason` is a stable code
 * (decode_failed, wrong_parts_count, legacy_empty_field, legacy_expired,
 * legacy_hmac_mismatch, empty_field, expired, bad_nonce_shape, hmac_mismatch,
 * unexpected_throw). Grep these to triage future auth issues.
 *
 * SECURITY: never log `token`, the HMAC `signature`, the computed `expected`,
 * or the raw `nonce` value. Reason + age + length is enough to triage.
 */
export function verifyAdminToken(token: string): boolean {
  const partsLengthPreDecode = token.split(":").length;
  const tokenHadPct = token.includes("%");
  try {
    // Defensive URL-decode. /api/admin/login uses NextResponse.cookies.set
    // which URL-encodes the value (`:` → `%3A`). Most Next.js cookie readers
    // auto-decode on read but some paths (notably middleware's
    // req.cookies.get) deliver the encoded form. Decode here so both shapes
    // verify identically. Caught 2026-05-27 during the PR #459 live e2e test.
    if (tokenHadPct) {
      try {
        token = decodeURIComponent(token);
      } catch {
        logger.warn("admin_token_verify_failed", {
          reason: "decode_failed",
          parts_length_pre_decode: partsLengthPreDecode,
        });
        // Malformed % sequence — fall through and let the split check fail.
      }
    }
    const parts = token.split(":");

    // Support both old format (timestamp:hmac) and new (timestamp:nonce:hmac)
    if (parts.length === 2) {
      // Legacy format — verify but with shorter window (1h)
      const [timestamp, signature] = parts;
      if (!timestamp || !signature) {
        logger.warn("admin_token_verify_failed", {
          reason: "legacy_empty_field",
          parts_length: 2,
        });
        return false;
      }
      const age = Date.now() - Number(timestamp);
      if (isNaN(age) || age > 3600 * 1000 || age < 0) {
        logger.warn("admin_token_verify_failed", {
          reason: "legacy_expired",
          age_ms: isNaN(age) ? null : age,
        });
        return false;
      }
      const expected = crypto
        .createHmac("sha256", getSecret())
        .update(timestamp)
        .digest("hex");
      const ok = crypto.timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected, "hex")
      );
      if (!ok) {
        logger.warn("admin_token_verify_failed", {
          reason: "legacy_hmac_mismatch",
          age_ms: age,
        });
      }
      return ok;
    }

    if (parts.length !== 3) {
      logger.warn("admin_token_verify_failed", {
        reason: "wrong_parts_count",
        parts_length: parts.length,
        token_has_pct: tokenHadPct,
      });
      return false;
    }
    const [timestamp, nonce, signature] = parts;
    if (!timestamp || !nonce || !signature) {
      logger.warn("admin_token_verify_failed", {
        reason: "empty_field",
        parts_length: 3,
      });
      return false;
    }

    // Reject tokens older than MAX_AGE
    const age = Date.now() - Number(timestamp);
    if (isNaN(age) || age > MAX_AGE * 1000 || age < 0) {
      logger.warn("admin_token_verify_failed", {
        reason: "expired",
        age_ms: isNaN(age) ? null : age,
      });
      return false;
    }

    // Validate nonce format (32 hex chars)
    if (!/^[0-9a-f]{32}$/.test(nonce)) {
      logger.warn("admin_token_verify_failed", {
        reason: "bad_nonce_shape",
        nonce_length: nonce.length,
      });
      return false;
    }

    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(`${timestamp}:${nonce}`)
      .digest("hex");

    const ok = crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
    if (!ok) {
      logger.warn("admin_token_verify_failed", {
        reason: "hmac_mismatch",
        age_ms: age,
      });
    }
    return ok;
  } catch (err) {
    logger.warn("admin_token_verify_failed", {
      reason: "unexpected_throw",
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Check admin access. Dual-mode:
 * 1. Supabase Auth — if auth flag is on, check for admin role
 * 2. HMAC cookie — fallback for existing admin flow
 * Redirects to login if neither passes.
 */
export async function requireAdmin(): Promise<void> {
  // Try Supabase Auth first (if enabled)
  if (featureFlags.auth) {
    try {
      const { getUser } = await import("@/lib/auth");
      const user = await getUser();
      if (user?.role === "admin") {
        return; // Admin via Supabase Auth
      }
    } catch {
      // Fall through to HMAC check
    }
  }

  // HMAC cookie fallback
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token || !verifyAdminToken(token)) {
    redirect("/admin/login");
  }
}

/**
 * Resolve the acting admin's user id when one is available (Supabase Auth
 * path). Returns null under the HMAC-cookie fallback — no user id exists.
 *
 * MUST be called AFTER requireAdmin() — this helper does not enforce admin
 * access, it only retrieves the user id for audit-trail writes.
 */
export async function getAdminUserId(): Promise<string | null> {
  if (!featureFlags.auth) return null;
  try {
    const { getUser } = await import("@/lib/auth");
    const user = await getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export { COOKIE_NAME, MAX_AGE };
