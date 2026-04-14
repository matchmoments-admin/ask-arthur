import type { AnalysisResult, ExtensionURLCheckResponse } from "@askarthur/types";

// Message types between popup <-> background service worker
export type MessageType =
  | "CHECK_URL"
  | "CHECK_TEXT"
  | "GET_STATUS"
  | "CHECK_URL_PASSIVE"
  | "SHOW_PHISHING_WARNING"
  | "SCAN_EXTENSIONS"
  | "DEEP_SCAN_EXTENSIONS"
  | "ANALYZE_AD"
  | "FLAG_AD"
  | "ANALYZE_MARKETPLACE";

export interface CheckURLMessage {
  type: "CHECK_URL";
  url: string;
}

export interface CheckTextMessage {
  type: "CHECK_TEXT";
  text: string;
}

export interface GetStatusMessage {
  type: "GET_STATUS";
}

export interface CheckURLPassiveMessage {
  type: "CHECK_URL_PASSIVE";
  url: string;
  tabId: number;
}

export interface ShowPhishingWarningMessage {
  type: "SHOW_PHISHING_WARNING";
  url: string;
  domain: string;
  threatLevel: string;
  reportCount?: number;
}

export interface ScanExtensionsMessage {
  type: "SCAN_EXTENSIONS";
}

export interface DeepScanExtensionsMessage {
  type: "DEEP_SCAN_EXTENSIONS";
  extensions: Array<{
    id: string;
    name: string;
    version: string;
  }>;
}

export interface AnalyzeAdMessage {
  type: "ANALYZE_AD";
  adText: string;
  landingUrl: string | null;
  imageUrl: string | null;
  advertiserName: string;
  adTextHash: string;
}

export interface FlagAdMessage {
  type: "FLAG_AD";
  advertiserName: string;
  landingUrl: string | null;
  adTextHash: string;
  verdict?: string;
  riskScore?: number;
}

export interface AnalyzeMarketplaceMessage {
  type: "ANALYZE_MARKETPLACE";
  listingTitle: string;
  listingDescription: string;
  sellerName: string;
  landingUrl: string | null;
  imageUrls: string[];
  context: "marketplace-listing" | "marketplace-chat";
  chatText?: string;
}

export type ExtensionMessage =
  | CheckURLMessage
  | CheckTextMessage
  | GetStatusMessage
  | CheckURLPassiveMessage
  | ShowPhishingWarningMessage
  | ScanExtensionsMessage
  | DeepScanExtensionsMessage
  | AnalyzeAdMessage
  | FlagAdMessage
  | AnalyzeMarketplaceMessage;

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Popup state
export type PopupView = "idle" | "loading" | "result" | "error";

export interface PopupState {
  view: PopupView;
  currentTabUrl: string | null;
  contextMenuText: string | null;
  urlResult: ExtensionURLCheckResponse | null;
  analysisResult: AnalysisResult | null;
  error: string | null;
  remaining: number | null;
}
