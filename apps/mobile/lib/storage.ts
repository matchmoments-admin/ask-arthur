import { MMKV } from "react-native-mmkv";
import type { Verdict } from "@askarthur/types";

const storage = new MMKV({ id: "askarthur-history" });

export interface ScanHistoryItem {
  id: string;
  text: string;
  verdict: Verdict;
  confidence: number;
  summary: string;
  timestamp: number;
  mode: string;
}

const HISTORY_KEY = "scan_history";
const MAX_HISTORY = 50;

/**
 * Get scan history, newest first.
 */
export function getScanHistory(): ScanHistoryItem[] {
  const raw = storage.getString(HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ScanHistoryItem[];
  } catch {
    return [];
  }
}

/**
 * Add an item to scan history.
 */
export function addToScanHistory(item: ScanHistoryItem): void {
  const history = getScanHistory();
  history.unshift(item);
  // Keep only the most recent items
  const trimmed = history.slice(0, MAX_HISTORY);
  storage.set(HISTORY_KEY, JSON.stringify(trimmed));
}

/**
 * Clear all scan history.
 */
export function clearScanHistory(): void {
  storage.delete(HISTORY_KEY);
}
