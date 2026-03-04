import * as SQLite from "expo-sqlite";

const DB_NAME = "arthur_threats.db";

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Initialize the offline threat database.
 * Creates tables if they don't exist. Safe to call multiple times.
 */
export async function initOfflineDB(): Promise<void> {
  if (db) return;

  db = await SQLite.openDatabaseAsync(DB_NAME);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS threat_domains (
      domain TEXT PRIMARY KEY,
      threat_level TEXT NOT NULL,
      scam_type TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

/**
 * Check if a domain is in the offline threat database.
 * Returns threat info or null if not found.
 */
export async function checkDomainOffline(
  domain: string
): Promise<{ threatLevel: string; scamType: string | null } | null> {
  if (!db) return null;

  const result = await db.getFirstAsync<{
    threat_level: string;
    scam_type: string | null;
  }>(
    "SELECT threat_level, scam_type FROM threat_domains WHERE domain = ?",
    [domain.toLowerCase()]
  );

  if (!result) return null;

  return {
    threatLevel: result.threat_level,
    scamType: result.scam_type,
  };
}

/**
 * Sync the offline threat database with the server's threat snapshot.
 * Fetches the latest compressed domain-level threat data.
 */
export async function syncThreatSnapshot(apiUrl: string): Promise<number> {
  if (!db) {
    await initOfflineDB();
  }

  // Check last sync time — don't sync more than once per day
  const lastSync = await db!.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = 'last_sync'"
  );

  if (lastSync) {
    const lastSyncTime = parseInt(lastSync.value, 10);
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (lastSyncTime > oneDayAgo) {
      return 0; // Already synced recently
    }
  }

  try {
    const res = await fetch(`${apiUrl}/api/mobile/threat-snapshot`);
    if (!res.ok) return 0;

    const data: Array<{
      domain: string;
      threat_level: string;
      scam_type: string | null;
    }> = await res.json();

    if (!Array.isArray(data) || data.length === 0) return 0;

    // Batch insert/replace in a transaction
    await db!.withTransactionAsync(async () => {
      // Clear old data
      await db!.runAsync("DELETE FROM threat_domains");

      // Insert in batches of 500
      for (let i = 0; i < data.length; i += 500) {
        const batch = data.slice(i, i + 500);
        for (const entry of batch) {
          await db!.runAsync(
            "INSERT OR REPLACE INTO threat_domains (domain, threat_level, scam_type, updated_at) VALUES (?, ?, ?, ?)",
            [entry.domain, entry.threat_level, entry.scam_type, Date.now()]
          );
        }
      }

      // Update sync timestamp
      await db!.runAsync(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('last_sync', ?)",
        [String(Date.now())]
      );
    });

    return data.length;
  } catch {
    return 0;
  }
}

/**
 * Get the number of entries in the offline threat database.
 */
export async function getOfflineDBStats(): Promise<{ count: number; lastSync: number | null }> {
  if (!db) return { count: 0, lastSync: null };

  const countResult = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM threat_domains"
  );

  const syncResult = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_meta WHERE key = 'last_sync'"
  );

  return {
    count: countResult?.count ?? 0,
    lastSync: syncResult ? parseInt(syncResult.value, 10) : null,
  };
}
