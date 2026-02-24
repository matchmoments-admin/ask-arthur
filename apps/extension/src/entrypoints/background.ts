import { setInstallId, getInstallId, setContextMenuText } from "@/lib/storage";
import { checkURL, analyzeText, ExtensionApiError } from "@/lib/api";
import type { ExtensionMessage, MessageResponse } from "@/lib/types";

export default defineBackground(() => {
  // --- onInstalled: generate UUID + create context menu ---
  chrome.runtime.onInstalled.addListener(async () => {
    const existing = await getInstallId();
    if (!existing) {
      await setInstallId(crypto.randomUUID());
    }

    chrome.contextMenus.create({
      id: "askarthur-check",
      title: "Check with Ask Arthur",
      contexts: ["selection"],
    });
  });

  // --- Context menu click: store text for popup ---
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId === "askarthur-check" && info.selectionText) {
      await setContextMenuText(info.selectionText);
      // Open the popup by triggering the action
      // Note: chrome.action.openPopup() requires Chrome 127+
      // Fallback: the text is stored and popup reads it on open
      if (chrome.action.openPopup) {
        chrome.action.openPopup().catch(() => {
          // Silently fail — user can click the extension icon
        });
      }
    }
  });

  // --- Message handler for popup communication ---
  chrome.runtime.onMessage.addListener(
    (
      message: ExtensionMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponse) => void
    ) => {
      handleMessage(message)
        .then(sendResponse)
        .catch((err) => {
          if (err instanceof ExtensionApiError) {
            sendResponse({
              success: false,
              error: err.message,
            });
          } else {
            sendResponse({
              success: false,
              error: "Something went wrong. Please try again.",
            });
          }
        });

      // Return true to indicate async response
      return true;
    }
  );
});

async function handleMessage(
  message: ExtensionMessage
): Promise<MessageResponse> {
  switch (message.type) {
    case "CHECK_URL": {
      const { data, remaining } = await checkURL(message.url);
      return { success: true, data: { ...data, remaining } };
    }
    case "CHECK_TEXT": {
      const { data, remaining } = await analyzeText(message.text);
      return { success: true, data: { ...data, remaining } };
    }
    case "GET_STATUS": {
      const installId = await getInstallId();
      return { success: true, data: { installId, ready: !!installId } };
    }
    default:
      return { success: false, error: "Unknown message type" };
  }
}
