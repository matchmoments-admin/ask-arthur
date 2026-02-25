import { setInstallId, getInstallId, setContextMenuText } from "@/lib/storage";
import { checkURL, analyzeText, reportScamEmail, ExtensionApiError } from "@/lib/api";
import { getCachedEmailScan, setCachedEmailScan } from "@/lib/email-cache";
import type { EmailContent, EmailScanResult } from "@askarthur/types";
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
    case "SCAN_EMAIL": {
      const { email } = message;

      // Check local cache first
      const cached = await getCachedEmailScan(email.messageId);
      if (cached) {
        return { success: true, data: cached };
      }

      // Compose email into structured text for Claude analysis
      const text = composeEmailForAnalysis(email);
      const { data } = await analyzeText(text, "email");

      const result: EmailScanResult = {
        messageId: email.messageId,
        verdict: data.verdict,
        confidence: data.confidence,
        summary: data.summary,
        redFlags: data.redFlags,
        nextSteps: data.nextSteps,
        scamType: data.scamType,
        impersonatedBrand: data.impersonatedBrand,
        scannedAt: Date.now(),
      };

      // Cache for future opens
      await setCachedEmailScan(result);
      return { success: true, data: result };
    }
    case "GET_EMAIL_CACHE": {
      const cached = await getCachedEmailScan(message.messageId);
      return { success: true, data: cached };
    }
    case "REPORT_EMAIL": {
      await reportScamEmail(message.report);
      return { success: true, data: { reported: true } };
    }
    default:
      return { success: false, error: "Unknown message type" };
  }
}

function composeEmailForAnalysis(email: EmailContent): string {
  const parts = [
    `[EMAIL ANALYSIS]`,
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    ``,
    email.body,
  ];

  if (email.links.length > 0) {
    parts.push("", `[Links found in email]`);
    for (const link of email.links.slice(0, 20)) {
      parts.push(`- ${link}`);
    }
  }

  return parts.join("\n").slice(0, 10000);
}
