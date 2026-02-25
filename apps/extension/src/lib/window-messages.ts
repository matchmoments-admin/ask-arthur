import type { EmailContent, EmailScanResult } from "@askarthur/types";

// Window message types for MAIN <-> ISOLATED world communication
const PREFIX = "ARTHUR_EXT_";

export const WindowMessageType = {
  SCAN_REQUEST: `${PREFIX}SCAN_REQUEST`,
  SCAN_RESPONSE: `${PREFIX}SCAN_RESPONSE`,
  REPORT_REQUEST: `${PREFIX}REPORT_REQUEST`,
  REPORT_RESPONSE: `${PREFIX}REPORT_RESPONSE`,
  CACHE_REQUEST: `${PREFIX}CACHE_REQUEST`,
  CACHE_RESPONSE: `${PREFIX}CACHE_RESPONSE`,
} as const;

export interface ScanRequest {
  type: typeof WindowMessageType.SCAN_REQUEST;
  requestId: string;
  email: EmailContent;
}

export interface ScanResponse {
  type: typeof WindowMessageType.SCAN_RESPONSE;
  requestId: string;
  success: boolean;
  data?: EmailScanResult;
  error?: string;
}

export interface ReportRequest {
  type: typeof WindowMessageType.REPORT_REQUEST;
  requestId: string;
  report: {
    senderEmail: string;
    subject: string;
    urls: string[];
    verdict: string;
    confidence: number;
  };
}

export interface ReportResponse {
  type: typeof WindowMessageType.REPORT_RESPONSE;
  requestId: string;
  success: boolean;
  error?: string;
}

export interface CacheRequest {
  type: typeof WindowMessageType.CACHE_REQUEST;
  requestId: string;
  messageId: string;
}

export interface CacheResponse {
  type: typeof WindowMessageType.CACHE_RESPONSE;
  requestId: string;
  data: EmailScanResult | null;
}

export type WindowMessage =
  | ScanRequest
  | ScanResponse
  | ReportRequest
  | ReportResponse
  | CacheRequest
  | CacheResponse;

function isArthurMessage(event: MessageEvent): boolean {
  return (
    event.source === window &&
    typeof event.data?.type === "string" &&
    event.data.type.startsWith(PREFIX)
  );
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Send a window message and await a response with matching requestId.
 * Used by MAIN world scripts to communicate with ISOLATED world relay.
 */
export function sendWindowMessage<T extends WindowMessage>(
  message: WindowMessage,
  responseType: string,
  timeoutMs = 30000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Window message timeout"));
    }, timeoutMs);

    function handler(event: MessageEvent) {
      if (!isArthurMessage(event)) return;
      if (event.data.type !== responseType) return;
      if (event.data.requestId !== message.requestId) return;

      clearTimeout(timer);
      window.removeEventListener("message", handler);
      resolve(event.data as T);
    }

    window.addEventListener("message", handler);
    window.postMessage(message, "*");
  });
}

export { isArthurMessage };
