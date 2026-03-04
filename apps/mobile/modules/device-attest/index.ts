import DeviceAttestModule from "./src/DeviceAttestModule";

export type AttestationResult = {
  token: string;
  platform: "ios" | "android";
};

/**
 * Request a device attestation token from the platform.
 * - Android: Uses Play Integrity API
 * - iOS: Uses App Attest (DCAppAttestService)
 *
 * @param challenge - Server-provided nonce to bind the attestation to
 * @returns Platform-signed attestation token
 */
export async function requestAttestation(
  challenge: string
): Promise<AttestationResult> {
  return DeviceAttestModule.requestAttestation(challenge);
}

/**
 * Check if device attestation is supported on this device.
 */
export async function isAttestationSupported(): Promise<boolean> {
  return DeviceAttestModule.isSupported();
}
