import type { AnalysisResult, ExtensionURLCheckResponse } from "@askarthur/types";

// Typed wrappers for chrome.storage

// --- chrome.storage.local (persisted across sessions) ---

export async function getInstallId(): Promise<string | null> {
  const result = await chrome.storage.local.get("installId");
  return (result.installId as string) ?? null;
}

export async function setInstallId(id: string): Promise<void> {
  await chrome.storage.local.set({ installId: id });
}

export async function getRegistered(): Promise<boolean> {
  const result = await chrome.storage.local.get("registered");
  return result.registered === true;
}

export async function setRegistered(value: boolean): Promise<void> {
  await chrome.storage.local.set({ registered: value });
}

// --- chrome.storage.session (transient, cleared on browser close) ---

export interface LastResult {
  type: "url" | "text";
  urlResult?: ExtensionURLCheckResponse;
  analysisResult?: AnalysisResult;
  timestamp: number;
}

export async function getLastResult(): Promise<LastResult | null> {
  const result = await chrome.storage.session.get("lastResult");
  return (result.lastResult as LastResult) ?? null;
}

export async function setLastResult(data: LastResult): Promise<void> {
  await chrome.storage.session.set({ lastResult: data });
}

export async function getContextMenuText(): Promise<string | null> {
  const result = await chrome.storage.session.get("contextMenuText");
  return (result.contextMenuText as string) ?? null;
}

export async function setContextMenuText(text: string | null): Promise<void> {
  await chrome.storage.session.set({ contextMenuText: text });
}
