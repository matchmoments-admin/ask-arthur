import bundledDB from "@/data/malicious-extensions.json";

const STORAGE_KEY = "arthur_threat_db";
const ALARM_NAME = "arthur_threat_db_refresh";
const REFRESH_INTERVAL_MINUTES = 24 * 60; // 24 hours

interface ThreatEntry {
  name: string;
  campaign: string;
  source: string;
}

interface ThreatDB {
  ids: Record<string, ThreatEntry>;
  updatedAt: string;
}

let cachedDB: ThreatDB | null = null;

export function loadBundledDB(): ThreatDB {
  return bundledDB as ThreatDB;
}

async function getStoredDB(): Promise<ThreatDB | null> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return (data[STORAGE_KEY] as ThreatDB) ?? null;
}

async function setStoredDB(db: ThreatDB): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: db });
}

export function mergeDB(base: ThreatDB, updates: ThreatDB): ThreatDB {
  return {
    ids: { ...base.ids, ...updates.ids },
    updatedAt: updates.updatedAt > base.updatedAt ? updates.updatedAt : base.updatedAt,
  };
}

export async function getThreatDB(): Promise<ThreatDB> {
  if (cachedDB) return cachedDB;

  const stored = await getStoredDB();
  const bundled = loadBundledDB();

  cachedDB = stored ? mergeDB(bundled, stored) : bundled;
  return cachedDB;
}

export function isKnownMalicious(extensionId: string, db: ThreatDB): ThreatEntry | null {
  return db.ids[extensionId] ?? null;
}

export async function refreshThreatDB(fetchUpdate: () => Promise<ThreatDB | null>): Promise<void> {
  try {
    const update = await fetchUpdate();
    if (!update) return;

    const bundled = loadBundledDB();
    const merged = mergeDB(bundled, update);
    await setStoredDB(merged);
    cachedDB = merged;
  } catch (err) {
    console.warn("[ThreatDB] Refresh failed:", err instanceof Error ? err.message : "Unknown");
  }
}

export function setupThreatDBRefresh(fetchUpdate: () => Promise<ThreatDB | null>): void {
  // Create alarm for periodic refresh
  chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: REFRESH_INTERVAL_MINUTES,
    delayInMinutes: 1, // First refresh 1 minute after install
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      refreshThreatDB(fetchUpdate);
    }
  });
}
