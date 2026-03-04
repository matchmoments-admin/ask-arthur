import type { ExtensionSecurityReport } from "@askarthur/types";

const CACHE_KEY = "arthur_ext_scan";
const TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CacheEntry {
  report: ExtensionSecurityReport;
  extensionIds: string[];
  cachedAt: number;
}

async function getEntry(): Promise<CacheEntry | null> {
  const data = await chrome.storage.local.get(CACHE_KEY);
  return (data[CACHE_KEY] as CacheEntry) ?? null;
}

export async function getCachedScanReport(): Promise<ExtensionSecurityReport | null> {
  const entry = await getEntry();
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.cachedAt > TTL_MS) {
    await chrome.storage.local.remove(CACHE_KEY);
    return null;
  }

  // Invalidate if extension list changed
  try {
    const hasManagement = await chrome.permissions.contains({
      permissions: ["management"],
    });
    if (hasManagement) {
      const currentExts = await chrome.management.getAll();
      const currentIds = currentExts
        .filter((e) => e.type === "extension" && e.id !== chrome.runtime.id)
        .map((e) => e.id)
        .sort();

      const cachedIds = [...entry.extensionIds].sort();

      if (
        currentIds.length !== cachedIds.length ||
        currentIds.some((id, i) => id !== cachedIds[i])
      ) {
        await chrome.storage.local.remove(CACHE_KEY);
        return null;
      }
    }
  } catch {
    // If we can't check, return cached data
  }

  return entry.report;
}

export async function setCachedScanReport(
  report: ExtensionSecurityReport
): Promise<void> {
  const entry: CacheEntry = {
    report,
    extensionIds: report.extensions.map((e) => e.id),
    cachedAt: Date.now(),
  };
  await chrome.storage.local.set({ [CACHE_KEY]: entry });
}
