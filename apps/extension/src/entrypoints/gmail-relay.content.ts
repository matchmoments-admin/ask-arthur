import { WindowMessageType } from "@/lib/window-messages";
import type { ExtensionMessage, MessageResponse } from "@/lib/types";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  world: "ISOLATED",
  runAt: "document_start",

  main() {
    const PREFIX = "ARTHUR_EXT_";

    window.addEventListener("message", async (event) => {
      // Only handle messages from this window with our prefix
      if (event.source !== window) return;
      if (typeof event.data?.type !== "string") return;
      if (!event.data.type.startsWith(PREFIX)) return;

      const { type, requestId } = event.data;

      if (type === WindowMessageType.SCAN_REQUEST) {
        const response = await chrome.runtime.sendMessage<ExtensionMessage, MessageResponse>({
          type: "SCAN_EMAIL",
          email: event.data.email,
        });

        window.postMessage({
          type: WindowMessageType.SCAN_RESPONSE,
          requestId,
          success: response?.success ?? false,
          data: response?.data,
          error: response?.error,
        }, "*");
      }

      if (type === WindowMessageType.REPORT_REQUEST) {
        const response = await chrome.runtime.sendMessage<ExtensionMessage, MessageResponse>({
          type: "REPORT_EMAIL",
          report: event.data.report,
        });

        window.postMessage({
          type: WindowMessageType.REPORT_RESPONSE,
          requestId,
          success: response?.success ?? false,
          error: response?.error,
        }, "*");
      }

      if (type === WindowMessageType.CACHE_REQUEST) {
        const response = await chrome.runtime.sendMessage<ExtensionMessage, MessageResponse>({
          type: "GET_EMAIL_CACHE",
          messageId: event.data.messageId,
        });

        window.postMessage({
          type: WindowMessageType.CACHE_RESPONSE,
          requestId,
          data: response?.data ?? null,
        }, "*");
      }
    });
  },
});
