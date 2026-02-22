import { requireNativeModule, Platform } from "expo-modules-core";

export type RiskLevel = "red" | "yellow" | "green";

export interface DangerousPermission {
  name: string;
  granted: boolean;
  protectionLevel: string;
}

export interface AppScanResult {
  packageName: string;
  appName: string;
  versionName: string;
  dangerousPermissions: DangerousPermission[];
  riskLevel: RiskLevel;
  riskReasons: string[];
}

// iOS returns empty array — no API for listing installed apps
const AppScannerModule =
  Platform.OS === "android"
    ? requireNativeModule("AppScanner")
    : null;

/**
 * Scan installed apps and return risk-scored results.
 * Android only — returns empty array on iOS.
 */
export async function scanInstalledApps(): Promise<AppScanResult[]> {
  if (!AppScannerModule) return [];
  return AppScannerModule.scanInstalledApps();
}
