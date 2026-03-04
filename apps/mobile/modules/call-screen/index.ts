import CallScreenModule from "./src/CallScreenModule";

/**
 * Enable the call screening service.
 * Returns true if the permission was granted.
 */
export async function enableCallScreening(): Promise<boolean> {
  return CallScreenModule.enable();
}

/**
 * Disable the call screening service.
 */
export async function disableCallScreening(): Promise<void> {
  return CallScreenModule.disable();
}

/**
 * Check if call screening is currently active.
 */
export async function isCallScreeningActive(): Promise<boolean> {
  return CallScreenModule.isActive();
}
