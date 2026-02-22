import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Verdict } from "@askarthur/types";

export interface ScanHistoryItem {
  id: string;
  text: string;
  verdict: Verdict;
  confidence: number;
  summary: string;
  timestamp: number;
  mode: string;
}

const HISTORY_KEY = "askarthur_scan_history";
const MAX_HISTORY = 50;

export async function getScanHistory(): Promise<ScanHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ScanHistoryItem[];
  } catch {
    return [];
  }
}

export async function addToScanHistory(item: ScanHistoryItem): Promise<void> {
  const history = await getScanHistory();
  history.unshift(item);
  const trimmed = history.slice(0, MAX_HISTORY);
  await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export async function clearScanHistory(): Promise<void> {
  await AsyncStorage.removeItem(HISTORY_KEY);
}
