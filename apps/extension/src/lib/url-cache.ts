interface CacheEntry {
  threatLevel: "NONE" | "MEDIUM" | "HIGH";
  domain: string;
  found: boolean;
  reportCount?: number;
  timestamp: number;
}

const MAX_ENTRIES = 1000;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

class URLReputationCache {
  private cache = new Map<string, CacheEntry>();

  get(url: string): CacheEntry | null {
    const entry = this.cache.get(url);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > TTL_MS) {
      this.cache.delete(url);
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(url);
    this.cache.set(url, entry);
    return entry;
  }

  set(url: string, entry: Omit<CacheEntry, "timestamp">): void {
    // Evict oldest if at capacity
    if (this.cache.size >= MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }

    this.cache.set(url, { ...entry, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

export const urlCache = new URLReputationCache();
export type { CacheEntry };
