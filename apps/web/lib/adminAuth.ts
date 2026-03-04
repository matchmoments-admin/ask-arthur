import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";

const COOKIE_NAME = "__aa_admin";
const MAX_AGE = 60 * 60 * 24; // 24 hours

function getSecret(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET not configured");
  return secret;
}

/** Create an HMAC-signed token: timestamp:hmac */
export function createAdminToken(): string {
  const timestamp = Date.now().toString();
  const hmac = crypto
    .createHmac("sha256", getSecret())
    .update(timestamp)
    .digest("hex");
  return `${timestamp}:${hmac}`;
}

/** Verify an HMAC-signed admin token */
export function verifyAdminToken(token: string): boolean {
  try {
    const [timestamp, signature] = token.split(":");
    if (!timestamp || !signature) return false;

    // Reject tokens older than 24h
    const age = Date.now() - Number(timestamp);
    if (isNaN(age) || age > MAX_AGE * 1000 || age < 0) return false;

    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(timestamp)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
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

export { COOKIE_NAME, MAX_AGE };
