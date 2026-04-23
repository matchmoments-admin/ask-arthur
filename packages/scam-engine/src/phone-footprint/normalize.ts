// MSISDN hashing + normalization for Phone Footprint.
//
// Hashing strategy:
//   msisdn_hash = HMAC-SHA256(msisdn_e164, PHONE_FOOTPRINT_PEPPER)
//
// The pepper lives in Supabase Vault (not env) once PHONE_FOOTPRINT_PEPPER
// is rotated out. During bootstrap, the env fallback is acceptable because
// the threat model is "database leak" not "app server compromise" — a
// peppered hash leaking without the pepper is still brute-force-resistant
// against 10-digit MSISDN space.
//
// Normalization reuses phone-normalize.ts to avoid divergence; we just
// import `normalizePhoneE164` and re-export for the phone-footprint barrel.

import { createHmac } from "node:crypto";
import { normalizePhoneE164 } from "../phone-normalize";

export { normalizePhoneE164 };

/**
 * Derive the MSISDN hash used in logs, cross-IP tracking, and DB indexes.
 * Never store the raw MSISDN where a hash would do.
 */
export function hashMsisdn(e164: string): string {
  const pepper = process.env.PHONE_FOOTPRINT_PEPPER;
  if (!pepper) {
    // Fail-loud in production — we must not silently fall back to an
    // unpeppered hash because that would make DB rows reversible via
    // rainbow-table on the 10-digit AU MSISDN space.
    if (process.env.NODE_ENV === "production") {
      throw new Error("PHONE_FOOTPRINT_PEPPER not configured");
    }
    // Dev fallback — predictable hash so local tests are stable.
    return createHmac("sha256", "dev-pepper-insecure").update(e164).digest("hex");
  }
  return createHmac("sha256", pepper).update(e164).digest("hex");
}

/**
 * Hash a caller-supplied identifier (IP or UA) for cross-IP enumeration
 * tracking. Uses the same pepper so the hash space is uniform, but a
 * different message prefix so collisions between (hashIp, hashMsisdn) are
 * impossible by construction.
 */
export function hashIdentifierForPf(prefix: "ip" | "ua", value: string): string {
  const pepper = process.env.PHONE_FOOTPRINT_PEPPER ?? "dev-pepper-insecure";
  return createHmac("sha256", pepper).update(`${prefix}:${value}`).digest("hex");
}
