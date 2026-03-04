import type { AnalysisResult, EmailContent, EmailScanResult, ExtensionURLCheckResponse } from "@askarthur/types";

// Message types between popup <-> background service worker
export type MessageType =
  | "CHECK_URL"
  | "CHECK_TEXT"
  | "GET_STATUS"
  | "SCAN_EMAIL"
  | "REPORT_EMAIL"
  | "GET_EMAIL_CACHE"
  | "CHECK_URL_PASSIVE"
  | "SHOW_PHISHING_WARNING"
  | "SCAN_EXTENSIONS"
  | "DEEP_SCAN_EXTENSIONS";

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

export interface ScanEmailMessage {
  type: "SCAN_EMAIL";
  email: EmailContent;
}

export interface ReportEmailMessage {
  type: "REPORT_EMAIL";
  report: {
    senderEmail: string;
    subject: string;
    urls: string[];
    verdict: string;
    confidence: number;
  };
}

export interface GetEmailCacheMessage {
  type: "GET_EMAIL_CACHE";
  messageId: string;
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

export type ExtensionMessage =
  | CheckURLMessage
  | CheckTextMessage
  | GetStatusMessage
  | ScanEmailMessage
  | ReportEmailMessage
  | GetEmailCacheMessage
  | CheckURLPassiveMessage
  | ShowPhishingWarningMessage
  | ScanExtensionsMessage
  | DeepScanExtensionsMessage;

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
