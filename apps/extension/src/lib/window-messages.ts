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
  hmac?: string;
}

export interface ScanResponse {
  type: typeof WindowMessageType.SCAN_RESPONSE;
  requestId: string;
  success: boolean;
  data?: EmailScanResult;
  error?: string;
  hmac?: string;
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
  hmac?: string;
}

export interface ReportResponse {
  type: typeof WindowMessageType.REPORT_RESPONSE;
  requestId: string;
  success: boolean;
  error?: string;
  hmac?: string;
}

export interface CacheRequest {
  type: typeof WindowMessageType.CACHE_REQUEST;
  requestId: string;
  messageId: string;
  hmac?: string;
}

export interface CacheResponse {
  type: typeof WindowMessageType.CACHE_RESPONSE;
  requestId: string;
  data: EmailScanResult | null;
  hmac?: string;
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

// ---------------------------------------------------------------------------
// HMAC signing / verification for postMessage security (S-EXT-2)
// ---------------------------------------------------------------------------

/**
 * Generate an HMAC-SHA256 signature for a window message.
 * Signs {type, requestId} to prove message origin.
 */
export async function signMessage(
  key: CryptoKey,
  type: string,
  requestId: string
): Promise<string> {
  const data = new TextEncoder().encode(`${type}:${requestId}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * Verify an HMAC-SHA256 signature on a window message.
 */
export async function verifyMessage(
  key: CryptoKey,
  type: string,
  requestId: string,
  hmac: string
): Promise<boolean> {
  const data = new TextEncoder().encode(`${type}:${requestId}`);
  const sigBytes = Uint8Array.from(atob(hmac), (c) => c.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, sigBytes, data);
}

/**
 * Generate a per-session HMAC key for signing window messages.
 */
export async function generateHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
}

/**
 * Export a CryptoKey to a base64 string for sharing between worlds.
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

/**
 * Import a base64 key string back into a CryptoKey.
 */
export async function importKey(keyStr: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyStr), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Send a window message and await a response with matching requestId.
 * Used by MAIN world scripts to communicate with ISOLATED world relay.
 * If an HMAC key is provided, signs outgoing and verifies incoming messages.
 */
export function sendWindowMessage<T extends WindowMessage>(
  message: WindowMessage,
  responseType: string,
  timeoutMs = 30000,
  hmacKey?: CryptoKey
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      reject(new Error("Window message timeout"));
    }, timeoutMs);

    async function handler(event: MessageEvent) {
      if (!isArthurMessage(event)) return;
      if (event.data.type !== responseType) return;
      if (event.data.requestId !== message.requestId) return;

      // Verify HMAC if key is available
      if (hmacKey && event.data.hmac) {
        const valid = await verifyMessage(
          hmacKey,
          event.data.type,
          event.data.requestId,
          event.data.hmac
        );
        if (!valid) return; // Silently drop invalid messages
      }

      clearTimeout(timer);
      window.removeEventListener("message", handler);
      resolve(event.data as T);
    }

    // Sign and send
    if (hmacKey) {
      signMessage(hmacKey, message.type, message.requestId).then((hmac) => {
        window.addEventListener("message", handler);
        window.postMessage({ ...message, hmac }, "*");
      });
    } else {
      window.addEventListener("message", handler);
      window.postMessage(message, "*");
    }
  });
}

export { isArthurMessage };
