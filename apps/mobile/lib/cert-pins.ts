import { initializeSslPinning, fetch as pinnedFetch } from "react-native-ssl-public-key-pinning";

/**
 * SHA-256 public key hashes for askarthur.au.
 *
 * Generate leaf hash with:
 *   openssl s_client -connect askarthur.au:443 -servername askarthur.au < /dev/null 2>/dev/null \
 *     | openssl x509 -pubkey -noout \
 *     | openssl pkey -pubin -outform der \
 *     | openssl dgst -sha256 -binary \
 *     | openssl enc -base64
 *
 * The backup pin is ISRG Root X1 (Let's Encrypt), which provides CA rotation safety.
 * ISRG Root X1 SPKI hash: C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=
 */
const CERT_PINS = {
  "askarthur.au": {
    includeSubdomains: true,
    publicKeyHashes: [
      // Leaf / intermediate certificate — replace with actual hash before store submission.
      // Run the openssl command above to get the current value.
      // Vercel uses Let's Encrypt certificates which rotate every ~90 days,
      // so pin the intermediate (R3/R10/R11) rather than the leaf for stability.
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      // ISRG Root X1 — backup pin for CA rotation safety
      "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=",
    ],
  },
};

let initialized = false;

/**
 * Initialize SSL certificate pinning for all API calls to askarthur.au.
 * Call once on app start. Safe to call multiple times (idempotent).
 */
export async function initCertPinning(): Promise<void> {
  if (initialized) return;

  try {
    await initializeSslPinning({
      domainPinningPolicies: CERT_PINS,
    });
    initialized = true;
  } catch (err) {
    // Don't crash the app if pinning fails — log and continue
    // In production, you may want to block API calls instead
    console.warn("SSL pinning initialization failed:", err);
  }
}

/**
 * Pinned fetch — use this instead of global fetch for API calls.
 * Falls back to regular fetch if pinning is not initialized.
 */
export { pinnedFetch };
