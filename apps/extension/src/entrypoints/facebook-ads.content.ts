import {
  detectSponsoredPost,
  extractAdContent,
  createWarningBanner,
  createSafeIndicator,
  hashAdText,
} from "@/lib/ad-detector";
import type { AdContent, AdAnalysisResult } from "@/lib/ad-detector";

declare const __FACEBOOK_ADS_ENABLED__: boolean;

export default defineContentScript({
  matches: ["https://www.facebook.com/*"],
  runAt: "document_idle",

  main() {
    if (typeof __FACEBOOK_ADS_ENABLED__ === "undefined" || !__FACEBOOK_ADS_ENABLED__) return;

    const processedAds = new WeakSet<HTMLElement>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    function scanForAds() {
      const feedUnits = document.querySelectorAll<HTMLElement>(
        '[data-pagelet^="FeedUnit_"], [role="article"]'
      );
      for (const unit of feedUnits) {
        if (processedAds.has(unit)) continue;
        processedAds.add(unit);

        if (!detectSponsoredPost(unit)) continue;

        const adContent = extractAdContent(unit);
        if (!adContent) continue;

        analyzeAd(adContent);
      }
    }

    async function analyzeAd(ad: AdContent) {
      const hash = await hashAdText(ad.adText);

      const response = await chrome.runtime.sendMessage({
        type: "ANALYZE_AD",
        adText: ad.adText,
        landingUrl: ad.landingUrl,
        advertiserName: ad.advertiserName,
        adTextHash: hash,
      });

      if (response?.success && response.data) {
        const result = response.data as AdAnalysisResult;

        if (result.verdict !== "SAFE") {
          const banner = createWarningBanner(
            result,
            ad.advertiserName,
            hash,
            ad.landingUrl
          );
          ad.feedUnitElement.style.position = "relative";
          ad.feedUnitElement.prepend(banner);
        } else {
          // Show small green shield for safe ads
          ad.feedUnitElement.style.position = "relative";
          ad.feedUnitElement.appendChild(createSafeIndicator());
        }
      }
    }

    // MutationObserver for infinite scroll
    const observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(scanForAds, 500);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Initial scan
    scanForAds();

    // Handle FLAG_AD responses from banner buttons
    document.addEventListener("arthur-flag-ad", async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      chrome.runtime.sendMessage({
        type: "FLAG_AD",
        advertiserName: detail.advertiserName,
        landingUrl: detail.landingUrl,
        adTextHash: detail.adTextHash,
      });
    });
  },
});
