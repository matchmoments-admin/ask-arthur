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

const AI_CONSENT_KEY = "askarthur_ai_consent";
const HISTORY_KEY = "askarthur_scan_history";
const MAX_HISTORY = 50;

export async function getAIConsent(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(AI_CONSENT_KEY);
    return value === "true";
  } catch {
    return false;
  }
}

export async function setAIConsent(consented: boolean): Promise<void> {
  await AsyncStorage.setItem(AI_CONSENT_KEY, consented ? "true" : "false");
}

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
