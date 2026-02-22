import { initializeSslPinning, fetch as pinnedFetch } from "react-native-ssl-public-key-pinning";

/**
 * SHA-256 public key hashes for askarthur.au.
 * Generate with: openssl s_client -connect askarthur.au:443 | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64
 *
 * TODO: Replace these placeholder hashes with actual production certificate hashes
 * before store submission. Include both primary and backup CA hashes.
 */
const CERT_PINS = {
  "askarthur.au": {
    includeSubdomains: true,
    publicKeyHashes: [
      // Primary certificate hash — replace with actual value
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      // Backup / CA intermediate hash — replace with actual value
      "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
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
