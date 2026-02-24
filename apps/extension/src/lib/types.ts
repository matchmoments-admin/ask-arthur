import type { AnalysisResult, ExtensionURLCheckResponse } from "@askarthur/types";

// Message types between popup <-> background service worker
export type MessageType = "CHECK_URL" | "CHECK_TEXT" | "GET_STATUS";

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

export type ExtensionMessage =
  | CheckURLMessage
  | CheckTextMessage
  | GetStatusMessage;

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
