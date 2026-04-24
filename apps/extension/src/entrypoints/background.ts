import { setInstallId, getInstallId, setContextMenuText } from "@/lib/storage";
import { ensureRegistered } from "@/lib/register";
import { checkURL, analyzeText, analyzeExtensionsCRX, fetchThreatDBUpdate, checkAdCommunityFlags, flagAd, analyzeAd, ExtensionApiError } from "@/lib/api";
import { getCachedScanReport, setCachedScanReport } from "@/lib/extension-scan-cache";
import { scanInstalledExtensions, buildSecurityReport } from "@/lib/extension-scanner";
import { setupThreatDBRefresh, getThreatDB } from "@/lib/threat-db";
import { urlCache } from "@/lib/url-cache";
import { detectPhoneInSelection } from "@/lib/phone-detect";
import type { ExtensionMessage, MessageResponse } from "@/lib/types";

const WEB_APP_BASE = "https://askarthur.au";

declare const __URL_GUARD_ENABLED__: boolean;
declare const __EXTENSION_SECURITY_ENABLED__: boolean;
declare const __FACEBOOK_ADS_ENABLED__: boolean;

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

    chrome.storage.local.set({ showSafeIndicator: false });

    // Register a per-install WebCrypto keypair. Best effort — retried on next
    // service-worker start if it fails (e.g. offline, Turnstile blocked).
    ensureRegistered().catch(() => {});

    // Set up threat DB refresh for extension security scanner
    if (typeof __EXTENSION_SECURITY_ENABLED__ !== "undefined" && __EXTENSION_SECURITY_ENABLED__) {
      setupThreatDBRefresh(async () => {
        const db = await getThreatDB();
        return fetchThreatDBUpdate(db.updatedAt);
      });
    }
  });

  // Existing installs that upgraded to this version will not fire onInstalled
  // with "install" reason — register on every startup instead (idempotent).
  chrome.runtime.onStartup.addListener(() => {
    ensureRegistered().catch(() => {});
  });

  // --- Context menu click: smart-route by selection type ---
  // If the selection looks like a phone number, route to the Phone
  // Footprint web app (richer UX than the popup, full report). Otherwise
  // fall through to the existing text-analysis flow via the popup.
  chrome.contextMenus.onClicked.addListener(async (info) => {
    if (info.menuItemId !== "askarthur-check" || !info.selectionText) return;

    const phoneE164 = detectPhoneInSelection(info.selectionText);
    if (phoneE164) {
      // Open the web app's lookup page with the number pre-filled —
      // the page reads ?msisdn= and auto-submits. Fresh tab so the
      // user's source page is preserved.
      const url = `${WEB_APP_BASE}/phone-footprint?msisdn=${encodeURIComponent(phoneE164)}&src=ext`;
      chrome.tabs.create({ url }).catch(() => {});
      return;
    }

    // Non-phone selection → existing popup-based text analysis flow.
    await setContextMenuText(info.selectionText);
    if (chrome.action.openPopup) {
      chrome.action.openPopup().catch(() => {
        // Silently fail — user can click the extension icon
      });
    }
  });

  // --- URL Guard: real-time URL checking on navigation (C1) ---
  if (typeof __URL_GUARD_ENABLED__ !== "undefined" && __URL_GUARD_ENABLED__) {
    chrome.webNavigation?.onCompleted.addListener(async (details) => {
      // Only check main frame navigations
      if (details.frameId !== 0) return;

      const url = details.url;
      if (!url || !url.startsWith("http")) return;

      const tabId = details.tabId;

      try {
        // Check local cache first
        const cached = urlCache.get(url);
        if (cached) {
          updateBadge(tabId, cached.threatLevel, cached.found);
          if (cached.found && cached.threatLevel === "HIGH") {
            chrome.tabs.sendMessage(tabId, {
              type: "SHOW_PHISHING_WARNING",
              url,
              domain: cached.domain,
              threatLevel: cached.threatLevel,
              reportCount: cached.reportCount,
            });
          }
          return;
        }

        // Check API
        const { data } = await checkURL(url);

        const threatLevel = data.found
          ? data.threatLevel ?? "MEDIUM"
          : "NONE";

        // Cache result
        urlCache.set(url, {
          threatLevel: threatLevel as "NONE" | "MEDIUM" | "HIGH",
          domain: data.domain ?? new URL(url).hostname,
          found: data.found,
          reportCount: data.reportCount,
        });

        updateBadge(tabId, threatLevel, data.found);

        // Show phishing warning for HIGH threats
        if (data.found && threatLevel === "HIGH") {
          chrome.tabs.sendMessage(tabId, {
            type: "SHOW_PHISHING_WARNING",
            url,
            domain: data.domain ?? new URL(url).hostname,
            threatLevel,
            reportCount: data.reportCount,
          });
        }
      } catch {
        // Silently fail — don't block navigation
      }
    });
  }

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

function updateBadge(
  tabId: number,
  threatLevel: string,
  found: boolean
): void {
  if (!found || threatLevel === "NONE") {
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#388E3C" });
    chrome.action.setBadgeText({ tabId, text: "OK" });
  } else if (threatLevel === "HIGH") {
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#D32F2F" });
    chrome.action.setBadgeText({ tabId, text: "!!" });
  } else {
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#F57C00" });
    chrome.action.setBadgeText({ tabId, text: "!" });
  }

  // Clear badge after 30 seconds for clean URLs
  if (!found || threatLevel === "NONE") {
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: "" });
    }, 30000);
  }
}

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
    case "SCAN_EXTENSIONS": {
      // Check cache first
      const cachedReport = await getCachedScanReport();
      if (cachedReport) {
        return { success: true, data: cachedReport };
      }

      const results = await scanInstalledExtensions();
      const report = buildSecurityReport(results);
      await setCachedScanReport(report);
      return { success: true, data: report };
    }
    case "DEEP_SCAN_EXTENSIONS": {
      const { data } = await analyzeExtensionsCRX(message.extensions);

      // Merge additional risk factors from CRX analysis into scan results
      return { success: true, data: data.results };
    }
    case "ANALYZE_AD": {
      const { adText, landingUrl, advertiserName, adTextHash, imageUrl } = message;

      // Check community flags first (cheap)
      const communityCheck = await checkAdCommunityFlags(adTextHash, landingUrl).catch(() => ({
        flagCount: 0,
        verdict: null,
      }));

      // If already flagged 3+ times, return immediately
      if (communityCheck.flagCount >= 3 && communityCheck.verdict) {
        return {
          success: true,
          data: {
            verdict: communityCheck.verdict,
            confidence: 0.8,
            summary: `This ad has been flagged by ${communityCheck.flagCount} users as suspicious.`,
            redFlags: ["Multiple community reports"],
            urlMalicious: false,
            communityFlagCount: communityCheck.flagCount,
          },
        };
      }

      // Use dedicated ad analysis endpoint (handles text + URL + Hive AI server-side)
      const { data } = await analyzeAd({
        adText, landingUrl, imageUrl, advertiserName, adTextHash,
      });

      return { success: true, data };
    }

    case "FLAG_AD": {
      const { advertiserName, landingUrl, adTextHash } = message;
      await flagAd(advertiserName, landingUrl, adTextHash);
      return { success: true };
    }

    case "ANALYZE_MARKETPLACE": {
      const { listingDescription, chatText, sellerName, landingUrl, context } = message;

      // Build text for analysis: combine listing description + chat if available
      const textToAnalyze =
        context === "marketplace-chat" && chatText
          ? chatText
          : `Facebook Marketplace listing by "${sellerName}": ${listingDescription}`;

      const adTextHash = await hashText(textToAnalyze);

      // Reuse analyzeAd endpoint
      const { data } = await analyzeAd({
        adText: textToAnalyze,
        landingUrl,
        imageUrl: null,
        advertiserName: sellerName,
        adTextHash,
      });

      return { success: true, data };
    }

    default:
      return { success: false, error: "Unknown message type" };
  }
}

async function hashText(text: string): Promise<string> {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  const data = new TextEncoder().encode(normalized);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

