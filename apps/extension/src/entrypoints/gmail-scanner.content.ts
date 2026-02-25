import * as InboxSDK from "@inboxsdk/core";
import type { EmailContent, EmailScanResult } from "@askarthur/types";
import {
  WindowMessageType,
  generateRequestId,
  sendWindowMessage,
  type ScanResponse,
  type CacheResponse,
  type ReportResponse,
} from "@/lib/window-messages";
import {
  createScanningBanner,
  createVerdictBanner,
  replaceBanner,
} from "@/lib/gmail-ui";

declare const __INBOXSDK_APP_ID__: string;
declare const __EMAIL_SCANNING_ENABLED__: boolean;

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  world: "MAIN",
  runAt: "document_idle",

  async main() {
    if (!__EMAIL_SCANNING_ENABLED__) return;

    const sdk = await InboxSDK.load(2, __INBOXSDK_APP_ID__);

    // Track in-flight scans to prevent duplicates during SPA transitions
    const inFlight = new Set<string>();

    sdk.Conversations.registerMessageViewHandler(async (messageView) => {
      const messageId = messageView.getMessageID();
      if (!messageId || inFlight.has(messageId)) return;

      // Check cache first via relay
      const cachedResult = await checkCache(messageId);
      if (cachedResult) {
        const bodyEl = messageView.getBodyElement();
        const email = extractEmailContent(messageView, messageId);
        const banner = createVerdictBanner(
          cachedResult,
          email ? () => reportEmail(email, cachedResult) : undefined,
          undefined
        );
        bodyEl.parentElement?.insertBefore(banner, bodyEl);
        return;
      }

      inFlight.add(messageId);

      try {
        // Extract email content
        const email = extractEmailContent(messageView, messageId);
        if (!email) {
          inFlight.delete(messageId);
          return;
        }

        // Show scanning indicator
        const bodyEl = messageView.getBodyElement();
        const scanningBanner = createScanningBanner();
        bodyEl.parentElement?.insertBefore(scanningBanner, bodyEl);

        // Send scan request through relay
        const response = await sendWindowMessage<ScanResponse>(
          {
            type: WindowMessageType.SCAN_REQUEST,
            requestId: generateRequestId(),
            email,
          },
          WindowMessageType.SCAN_RESPONSE
        );

        if (response.success && response.data) {
          const verdictBanner = createVerdictBanner(
            response.data,
            () => reportEmail(email, response.data!),
            undefined
          );
          replaceBanner(
            bodyEl.parentElement!,
            scanningBanner,
            verdictBanner
          );
        } else {
          // Remove scanning banner on error — don't block the user
          scanningBanner.remove();
        }
      } catch {
        // Silently fail — don't disrupt Gmail experience
      } finally {
        inFlight.delete(messageId);
      }
    });
  },
});

function extractEmailContent(
  messageView: InboxSDK.MessageView,
  messageId: string
): EmailContent | null {
  try {
    const sender = messageView.getSender();
    const bodyEl = messageView.getBodyElement();

    // Get subject from the thread view
    let subject = "";
    const subjectEl = document.querySelector<HTMLElement>(
      'h2[data-thread-perm-id]'
    );
    if (subjectEl) {
      subject = subjectEl.textContent?.trim() ?? "";
    }
    // Fallback: try common Gmail subject selectors
    if (!subject) {
      const altSubjectEl = document.querySelector<HTMLElement>(
        ".hP"
      );
      if (altSubjectEl) {
        subject = altSubjectEl.textContent?.trim() ?? "";
      }
    }

    // Get body text (skip quoted/forwarded content where possible)
    const bodyText = bodyEl.innerText?.trim() ?? "";
    if (!bodyText) return null;

    // Extract links from body, filtering out Gmail UI links
    const links: string[] = [];
    const anchors = bodyEl.querySelectorAll("a[href]");
    for (const a of anchors) {
      const href = (a as HTMLAnchorElement).href;
      if (
        href &&
        !href.startsWith("mailto:") &&
        !href.includes("mail.google.com") &&
        !href.startsWith("#")
      ) {
        links.push(href);
      }
    }
    // Deduplicate
    const uniqueLinks = [...new Set(links)];

    return {
      messageId,
      from: sender?.emailAddress ?? sender?.name ?? "Unknown",
      subject,
      body: bodyText.slice(0, 8000), // Cap body to leave room for metadata
      links: uniqueLinks.slice(0, 20),
    };
  } catch {
    return null;
  }
}

async function checkCache(messageId: string): Promise<EmailScanResult | null> {
  try {
    const response = await sendWindowMessage<CacheResponse>(
      {
        type: WindowMessageType.CACHE_REQUEST,
        requestId: generateRequestId(),
        messageId,
      },
      WindowMessageType.CACHE_RESPONSE,
      5000
    );
    return response.data ?? null;
  } catch {
    return null;
  }
}

async function reportEmail(
  email: EmailContent,
  result: EmailScanResult
): Promise<void> {
  try {
    await sendWindowMessage<ReportResponse>(
      {
        type: WindowMessageType.REPORT_REQUEST,
        requestId: generateRequestId(),
        report: {
          senderEmail: email.from,
          subject: email.subject,
          urls: email.links,
          verdict: result.verdict,
          confidence: result.confidence,
        },
      },
      WindowMessageType.REPORT_RESPONSE
    );
  } catch {
    // Silently fail — report is best-effort
  }
}
