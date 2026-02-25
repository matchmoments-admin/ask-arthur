import type { EmailScanResult } from "@askarthur/types";

const CACHE_KEY = "emailScanCache";
const MAX_ENTRIES = 500;
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry {
  result: EmailScanResult;
  cachedAt: number;
}

type CacheStore = Record<string, CacheEntry>;

async function getStore(): Promise<CacheStore> {
  const data = await chrome.storage.local.get(CACHE_KEY);
  return (data[CACHE_KEY] as CacheStore) ?? {};
}

async function setStore(store: CacheStore): Promise<void> {
  await chrome.storage.local.set({ [CACHE_KEY]: store });
}

export async function getCachedEmailScan(
  messageId: string
): Promise<EmailScanResult | null> {
  const store = await getStore();
  const entry = store[messageId];
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.cachedAt > TTL_MS) {
    delete store[messageId];
    await setStore(store);
    return null;
  }

  return entry.result;
}

export async function setCachedEmailScan(
  result: EmailScanResult
): Promise<void> {
  const store = await getStore();

  // LRU eviction if at capacity
  const keys = Object.keys(store);
  if (keys.length >= MAX_ENTRIES) {
    // Remove oldest entries
    const sorted = keys.sort(
      (a, b) => (store[a]!.cachedAt) - (store[b]!.cachedAt)
    );
    const toRemove = sorted.slice(0, keys.length - MAX_ENTRIES + 1);
    for (const key of toRemove) {
      delete store[key];
    }
  }

  store[result.messageId] = {
    result,
    cachedAt: Date.now(),
  };

  await setStore(store);
}
