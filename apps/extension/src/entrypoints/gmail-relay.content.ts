import { WindowMessageType, generateHmacKey, exportKey, signMessage, verifyMessage } from "@/lib/window-messages";
import type { ExtensionMessage, MessageResponse } from "@/lib/types";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  world: "ISOLATED",
  runAt: "document_start",

  async main() {
    const PREFIX = "ARTHUR_EXT_";

    // Generate per-session HMAC key
    const hmacKey = await generateHmacKey();
    const keyStr = await exportKey(hmacKey);

    // Inject the HMAC key into the MAIN world via a one-time script tag
    const script = document.createElement("script");
    script.textContent = `window.__ARTHUR_HMAC_KEY__="${keyStr}";`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    window.addEventListener("message", async (event) => {
      // Only handle messages from this window with our prefix
      if (event.source !== window) return;
      if (typeof event.data?.type !== "string") return;
      if (!event.data.type.startsWith(PREFIX)) return;

      const { type, requestId, hmac } = event.data;

      // Verify HMAC on incoming messages — drop silently if invalid
      if (hmac) {
        const valid = await verifyMessage(hmacKey, type, requestId, hmac);
        if (!valid) return;
      }

      if (type === WindowMessageType.SCAN_REQUEST) {
        const response = await chrome.runtime.sendMessage<ExtensionMessage, MessageResponse>({
          type: "SCAN_EMAIL",
          email: event.data.email,
        });

        const responseHmac = await signMessage(hmacKey, WindowMessageType.SCAN_RESPONSE, requestId);
        window.postMessage({
          type: WindowMessageType.SCAN_RESPONSE,
          requestId,
          success: response?.success ?? false,
          data: response?.data,
          error: response?.error,
          hmac: responseHmac,
        }, "*");
      }

      if (type === WindowMessageType.REPORT_REQUEST) {
        const response = await chrome.runtime.sendMessage<ExtensionMessage, MessageResponse>({
          type: "REPORT_EMAIL",
          report: event.data.report,
        });

        const responseHmac = await signMessage(hmacKey, WindowMessageType.REPORT_RESPONSE, requestId);
        window.postMessage({
          type: WindowMessageType.REPORT_RESPONSE,
          requestId,
          success: response?.success ?? false,
          error: response?.error,
          hmac: responseHmac,
        }, "*");
      }

      if (type === WindowMessageType.CACHE_REQUEST) {
        const response = await chrome.runtime.sendMessage<ExtensionMessage, MessageResponse>({
          type: "GET_EMAIL_CACHE",
          messageId: event.data.messageId,
        });

        const responseHmac = await signMessage(hmacKey, WindowMessageType.CACHE_RESPONSE, requestId);
        window.postMessage({
          type: WindowMessageType.CACHE_RESPONSE,
          requestId,
          data: response?.data ?? null,
          hmac: responseHmac,
        }, "*");
      }
    });
  },
});
