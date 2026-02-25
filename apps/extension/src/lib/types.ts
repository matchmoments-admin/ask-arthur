import type { AnalysisResult, EmailContent, EmailScanResult, ExtensionURLCheckResponse } from "@askarthur/types";

// Message types between popup <-> background service worker
export type MessageType =
  | "CHECK_URL"
  | "CHECK_TEXT"
  | "GET_STATUS"
  | "SCAN_EMAIL"
  | "REPORT_EMAIL"
  | "GET_EMAIL_CACHE";

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

export type ExtensionMessage =
  | CheckURLMessage
  | CheckTextMessage
  | GetStatusMessage
  | ScanEmailMessage
  | ReportEmailMessage
  | GetEmailCacheMessage;

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
