import type {
  ExtensionRiskLevel,
  ExtensionRiskFactor,
  ExtensionScanResult,
  ExtensionSecurityReport,
} from "@askarthur/types";
import { getThreatDB, isKnownMalicious } from "./threat-db";

// --- Permission management ---

export async function hasManagementPermission(): Promise<boolean> {
  return chrome.permissions.contains({ permissions: ["management"] });
}

export async function requestManagementPermission(): Promise<boolean> {
  return chrome.permissions.request({ permissions: ["management"] });
}

// --- Permission danger weights ---

const CRITICAL_PERMISSIONS: Record<string, number> = {
  debugger: 30,
  proxy: 30,
  vpnProvider: 30,
  nativeMessaging: 30,
};

const HIGH_PERMISSIONS: Record<string, number> = {
  webRequest: 20,
  webRequestBlocking: 20,
  cookies: 20,
  browsingData: 20,
  downloads: 20,
  management: 20,
};

const MEDIUM_PERMISSIONS: Record<string, number> = {
  tabs: 10,
  history: 10,
  bookmarks: 10,
  webNavigation: 10,
  notifications: 10,
};

const LOW_PERMISSIONS: Record<string, number> = {
  activeTab: 3,
  storage: 3,
  contextMenus: 3,
  alarms: 3,
};

function getPermissionWeight(perm: string): number {
  return (
    CRITICAL_PERMISSIONS[perm] ??
    HIGH_PERMISSIONS[perm] ??
    MEDIUM_PERMISSIONS[perm] ??
    LOW_PERMISSIONS[perm] ??
    5 // unknown permissions get moderate weight
  );
}

// --- Scoring ---

export function scoreExtension(
  ext: chrome.management.ExtensionInfo
): ExtensionScanResult {
  const riskFactors: ExtensionRiskFactor[] = [];
  let score = 0;

  const permissions = ext.permissions ?? [];
  const hostPermissions = ext.hostPermissions ?? [];
  const db = null; // Will be set async — see scanInstalledExtensions

  // 1. Permission danger scoring
  for (const perm of permissions) {
    const weight = getPermissionWeight(perm);
    score += weight;

    if (CRITICAL_PERMISSIONS[perm]) {
      riskFactors.push({
        id: `PERM_CRITICAL_${perm.toUpperCase()}`,
        label: `Critical permission: ${perm}`,
        severity: "CRITICAL",
        description: `The "${perm}" permission gives this extension very deep browser access.`,
      });
    } else if (HIGH_PERMISSIONS[perm]) {
      riskFactors.push({
        id: `PERM_HIGH_${perm.toUpperCase()}`,
        label: `High-risk permission: ${perm}`,
        severity: "HIGH",
        description: `The "${perm}" permission can access sensitive browser data.`,
      });
    }
  }

  // 2. Host permission scoring
  const hasBroadHost = hostPermissions.some(
    (h) => h === "<all_urls>" || h === "*://*/*"
  );
  if (hasBroadHost) {
    score += 25;
    riskFactors.push({
      id: "BROAD_HOST_ACCESS",
      label: "Access to all websites",
      severity: "HIGH",
      description:
        "This extension can read and modify data on every website you visit.",
    });
  } else {
    const hostCount = hostPermissions.length;
    score += Math.min(hostCount * 3, 15);
    if (hostCount > 3) {
      riskFactors.push({
        id: "MANY_HOSTS",
        label: `Access to ${hostCount} websites`,
        severity: "MEDIUM",
        description: `This extension has access to ${hostCount} specific websites.`,
      });
    }
  }

  // 3. Dangerous combos
  const hasWebRequest = permissions.includes("webRequest") || permissions.includes("webRequestBlocking");
  const hasCookies = permissions.includes("cookies");

  if (hasWebRequest && hasCookies && hasBroadHost) {
    score += 30;
    riskFactors.push({
      id: "COMBO_INTERCEPT_COOKIES",
      label: "Can intercept requests + read cookies",
      severity: "CRITICAL",
      description:
        "This combination allows intercepting web traffic and reading authentication cookies on all sites.",
    });
  } else if (hasWebRequest && hasBroadHost) {
    score += 20;
    riskFactors.push({
      id: "COMBO_INTERCEPT_ALL",
      label: "Can intercept all web requests",
      severity: "HIGH",
      description:
        "This extension can monitor and modify all web traffic.",
    });
  }

  // 4. Install type flags
  if (ext.installType === "development") {
    score += 15;
    riskFactors.push({
      id: "DEV_MODE",
      label: "Developer mode extension",
      severity: "MEDIUM",
      description:
        "This extension was loaded in developer mode and hasn't been reviewed by a store.",
    });
  } else if (ext.installType === "sideload") {
    score += 15;
    riskFactors.push({
      id: "SIDELOADED",
      label: "Sideloaded extension",
      severity: "MEDIUM",
      description:
        "This extension was installed outside the official store.",
    });
  }

  // 5. Disabled discount
  if (!ext.enabled) {
    score = Math.round(score * 0.5);
  }

  // 6. Determine risk level
  const riskLevel = getRiskLevel(score);

  // Get icon URL
  const iconUrl = ext.icons?.length
    ? ext.icons[ext.icons.length - 1]!.url
    : undefined;

  return {
    id: ext.id,
    name: ext.name,
    version: ext.version,
    enabled: ext.enabled,
    installType: ext.installType,
    permissions,
    hostPermissions,
    riskLevel,
    riskScore: Math.min(score, 100),
    riskFactors,
    isKnownMalicious: false, // Set in scanInstalledExtensions
    iconUrl,
    homepageUrl: ext.homepageUrl,
  };
}

function getRiskLevel(score: number): ExtensionRiskLevel {
  if (score >= 76) return "CRITICAL";
  if (score >= 51) return "HIGH";
  if (score >= 26) return "MEDIUM";
  return "LOW";
}

export async function scanInstalledExtensions(): Promise<ExtensionScanResult[]> {
  const extensions = await chrome.management.getAll();
  const threatDB = await getThreatDB();

  // Filter to extensions only (not themes, etc.)
  const extOnly = extensions.filter(
    (e) => e.type === "extension" && e.id !== chrome.runtime.id
  );

  return extOnly.map((ext) => {
    const result = scoreExtension(ext);

    // Check against known malicious DB
    const malEntry = isKnownMalicious(ext.id, threatDB);
    if (malEntry) {
      result.isKnownMalicious = true;
      result.riskScore = 100;
      result.riskLevel = "CRITICAL";
      result.riskFactors.unshift({
        id: "KNOWN_MALICIOUS",
        label: "Known malicious extension",
        severity: "CRITICAL",
        description: `This extension was identified as malicious (campaign: ${malEntry.campaign}). Remove it immediately.`,
      });
    }

    return result;
  });
}

export function buildSecurityReport(
  results: ExtensionScanResult[]
): ExtensionSecurityReport {
  const riskBreakdown: Record<ExtensionRiskLevel, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };

  for (const r of results) {
    riskBreakdown[r.riskLevel]++;
  }

  // Overall risk = highest individual risk found
  let overallRiskLevel: ExtensionRiskLevel = "LOW";
  if (riskBreakdown.CRITICAL > 0) overallRiskLevel = "CRITICAL";
  else if (riskBreakdown.HIGH > 0) overallRiskLevel = "HIGH";
  else if (riskBreakdown.MEDIUM > 0) overallRiskLevel = "MEDIUM";

  return {
    scannedAt: Date.now(),
    totalExtensions: results.length,
    enabledExtensions: results.filter((r) => r.enabled).length,
    riskBreakdown,
    extensions: results.sort((a, b) => b.riskScore - a.riskScore),
    overallRiskLevel,
  };
}
