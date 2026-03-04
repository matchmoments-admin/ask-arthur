import SmsFilterModule from "./src/SmsFilterModule";

/**
 * Check if SMS filtering is enabled in system settings.
 */
export async function isSmsFilterEnabled(): Promise<boolean> {
  return SmsFilterModule.isEnabled();
}

/**
 * Open the system settings page for SMS filtering.
 */
export async function openSmsFilterSettings(): Promise<void> {
  return SmsFilterModule.openSettings();
}
