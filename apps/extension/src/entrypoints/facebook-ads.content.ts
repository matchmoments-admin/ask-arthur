import {
  detectSponsoredPost,
  extractAdContent,
  createWarningBanner,
  createSafeIndicator,
  hashAdText,
} from "@/lib/ad-detector";
import type { AdAnalysisResult } from "@/lib/ad-detector";

declare const __FACEBOOK_ADS_ENABLED__: boolean;

export default defineContentScript({
  matches: [
    "https://www.facebook.com/*",
    "https://m.facebook.com/*",
    "https://web.facebook.com/*",
  ],
  runAt: "document_idle",

  main() {
    if (typeof __FACEBOOK_ADS_ENABLED__ === "undefined" || !__FACEBOOK_ADS_ENABLED__) return;

    const processedAds = new WeakSet<HTMLElement>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let feedObserver: MutationObserver | null = null;

    // --- Session cache: avoid re-analyzing the same ad on scroll-back ---
    const resultCache = new Map<string, AdAnalysisResult>();

    async function getCachedResult(hash: string): Promise<AdAnalysisResult | null> {
      if (resultCache.has(hash)) return resultCache.get(hash)!;
      try {
        const cached = await chrome.storage.session.get(`ad-${hash}`);
        if (cached[`ad-${hash}`]) {
          const result = cached[`ad-${hash}`] as AdAnalysisResult;
          resultCache.set(hash, result);
          return result;
        }
      } catch {
        // Session storage unavailable — continue without cache
      }
      return null;
    }

    async function setCachedResult(hash: string, result: AdAnalysisResult): Promise<void> {
      if (resultCache.size >= 200) {
        const keys = [...resultCache.keys()].slice(0, 50);
        keys.forEach((k) => resultCache.delete(k));
      }
      resultCache.set(hash, result);
      try {
        await chrome.storage.session.set({ [`ad-${hash}`]: result });
      } catch {
        // Silently fail — in-memory cache still works
      }
    }

    // --- Feed unit scanning ---
    function scanFeedUnits(root: Element) {
      const feedUnits = root.querySelectorAll<HTMLElement>(
        '[data-pagelet^="FeedUnit_"], [data-pagelet^="FeedUnit "], [role="article"]'
      );
      for (const unit of feedUnits) {
        if (processedAds.has(unit)) continue;
        processedAds.add(unit);

        // Delay 200ms: Facebook often renders the "Sponsored" label after the container
        setTimeout(() => {
          if (!detectSponsoredPost(unit)) return;

          const adContent = extractAdContent(unit);
          if (!adContent) return;

          analyzeAd(adContent);
        }, 200);
      }
    }

    async function analyzeAd(ad: ReturnType<typeof extractAdContent> & {}) {
      if (!ad) return;
      const hash = await hashAdText(ad.adText);

      // Check session cache first
      const cached = await getCachedResult(hash);
      if (cached) {
        injectOverlay(ad.feedUnitElement, cached, ad.advertiserName, hash, ad.landingUrl);
        return;
      }

      // Send to background for analysis
      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_AD",
        adText: ad.adText,
        landingUrl: ad.landingUrl,
        imageUrl: ad.imageUrl,
        advertiserName: ad.advertiserName,
        adTextHash: hash,
      });

      if (response?.success && response.data) {
        const result = response.data as AdAnalysisResult;
        await setCachedResult(hash, result);
        injectOverlay(ad.feedUnitElement, result, ad.advertiserName, hash, ad.landingUrl);
      }
    }

    async function injectOverlay(
      feedUnit: HTMLElement,
      result: AdAnalysisResult,
      advertiserName: string,
      hash: string,
      landingUrl: string | null
    ) {
      // Prevent duplicate overlays
      if (feedUnit.querySelector(".arthur-ad-banner, .arthur-ad-safe")) return;

      feedUnit.style.position = "relative";
      if (result.verdict !== "SAFE") {
        const banner = createWarningBanner(result, advertiserName, hash, landingUrl);
        feedUnit.prepend(banner);
      } else {
        // Only show safe indicator if user opted in
        const { showSafeIndicator } = await chrome.storage.local.get("showSafeIndicator");
        if (showSafeIndicator) {
          feedUnit.appendChild(createSafeIndicator());
        }
      }
    }

    // --- MutationObserver with SPA resilience ---
    function attachFeedObserver(feedElement: Element) {
      feedObserver?.disconnect();
      feedObserver = new MutationObserver((mutations) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== Node.ELEMENT_NODE) continue;
              scanFeedUnits(node as Element);
            }
          }
        }, 150);
      });
      feedObserver.observe(feedElement, { childList: true, subtree: true });
    }

    // Wait for feed to appear (SPA may not render it immediately)
    function initFeedObserver() {
      const feed = document.querySelector<HTMLElement>('div[role="feed"]');
      if (feed) {
        attachFeedObserver(feed);
        scanFeedUnits(feed);
        return;
      }

      // Feed not yet rendered — watch for it
      const bodyObs = new MutationObserver(() => {
        const f = document.querySelector<HTMLElement>('div[role="feed"]');
        if (f) {
          bodyObs.disconnect();
          attachFeedObserver(f);
          scanFeedUnits(f);
        }
      });
      bodyObs.observe(document.body, { childList: true, subtree: true });

      // Give up after 15s
      setTimeout(() => bodyObs.disconnect(), 15000);
    }

    // Heartbeat: re-attach if SPA navigation destroys and recreates the feed
    setInterval(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed && !feedObserver) {
        attachFeedObserver(feed);
        scanFeedUnits(feed);
      }
    }, 3000);

    // Start
    initFeedObserver();

    // Handle FLAG_AD from banner buttons
    document.addEventListener("arthur-flag-ad", async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Include the cached analysis result for storing verdict/risk
      const cachedResult = resultCache.get(detail.adTextHash);
      chrome.runtime.sendMessage({
        type: "FLAG_AD",
        advertiserName: detail.advertiserName,
        landingUrl: detail.landingUrl,
        adTextHash: detail.adTextHash,
        verdict: cachedResult?.verdict,
        riskScore: cachedResult?.confidence ? Math.round(cachedResult.confidence * 100) : undefined,
      });
    });
  },
});
