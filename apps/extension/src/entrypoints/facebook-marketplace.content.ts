import {
  extractMarketplaceListing,
  computeTrustScore,
  createTrustBadge,
  detectPayIDScamPatterns,
  createChatWarningBanner,
} from "@/lib/marketplace-detector";
import type { MarketplaceListing, TrustScore } from "@/lib/marketplace-detector";

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

    const processedListings = new WeakSet<HTMLElement>();
    const processedChatBatches = new Set<string>();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pageObserver: MutationObserver | null = null;
    let lastPathname = window.location.pathname;

    // --- Session cache: avoid re-analyzing the same listing ---
    const resultCache = new Map<string, { listing: MarketplaceListing; trust: TrustScore }>();

    async function hashText(text: string): Promise<string> {
      const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
      const data = new TextEncoder().encode(normalized);
      const buf = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    // --- Page mode detection ---
    function getPageMode(): "listing" | "chat" | "browse" | null {
      const path = window.location.pathname;
      if (/\/marketplace\/item\/\d+/.test(path)) return "listing";
      if (path.includes("/messages/")) return "chat";
      if (path.includes("/marketplace")) return "browse";
      return null;
    }

    // --- Mode A: Marketplace listing page ---
    async function handleListingPage() {
      // Wait a bit for SPA rendering
      await new Promise((r) => setTimeout(r, 500));

      const mainContent =
        document.querySelector<HTMLElement>('[role="main"]') ?? document.body;

      if (processedListings.has(mainContent)) return;
      processedListings.add(mainContent);

      const listing = extractMarketplaceListing(mainContent);
      if (!listing) return;

      const cacheKey = listing.listingUrl;
      let trust: TrustScore;

      const cached = resultCache.get(cacheKey);
      if (cached) {
        trust = cached.trust;
      } else {
        trust = computeTrustScore(listing.seller, listing);
        resultCache.set(cacheKey, { listing, trust });
      }

      // Inject trust badge near seller name
      const sellerLink = mainContent.querySelector<HTMLElement>(
        'a[href*="/marketplace/profile/"]'
      );
      const badgeTarget = sellerLink?.parentElement ?? sellerLink;
      if (badgeTarget && !badgeTarget.querySelector(".arthur-trust-badge")) {
        const badge = createTrustBadge(trust, listing.seller.name);
        badgeTarget.insertAdjacentElement("afterend", badge);
      }

      // For non-trusted sellers, also send to API for full analysis
      if (trust.level !== "trusted" && listing.description) {
        try {
          const textHash = await hashText(listing.description);
          chrome.runtime.sendMessage({
            type: "ANALYZE_MARKETPLACE",
            listingTitle: listing.title,
            listingDescription: listing.description,
            sellerName: listing.seller.name,
            landingUrl: listing.listingUrl,
            imageUrls: listing.imageUrls,
            context: "marketplace-listing",
          });
        } catch {
          // Silently fail — trust badge is already shown
        }
      }
    }

    // --- Mode B: Messenger chat with Marketplace context ---
    function handleChatPage() {
      const chatContainer =
        document.querySelector<HTMLElement>('[role="main"]') ?? document.body;

      // Check if conversation has Marketplace context (product preview/link)
      const hasMarketplaceContext =
        !!chatContainer.querySelector(
          'a[href*="/marketplace/item/"], a[href*="facebook.com/marketplace"]'
        ) ||
        (chatContainer.innerText ?? "").includes("Marketplace");

      if (!hasMarketplaceContext) return;

      // Gather message text from [dir="auto"] containers
      const messageDivs =
        chatContainer.querySelectorAll<HTMLElement>('[dir="auto"]');
      const texts: string[] = [];
      for (const div of messageDivs) {
        const text = div.textContent?.trim() ?? "";
        if (text.length > 5) {
          texts.push(text);
        }
      }

      const concatenated = texts.join(" ");
      if (!concatenated) return;

      // Deduplicate: hash the concatenated text to avoid re-checking
      const batchKey = concatenated.slice(0, 500);
      if (processedChatBatches.has(batchKey)) return;
      processedChatBatches.add(batchKey);

      // Keep set from growing unbounded
      if (processedChatBatches.size > 200) {
        const firstKey = processedChatBatches.values().next().value;
        if (firstKey) processedChatBatches.delete(firstKey);
      }

      // Run PayID scam pattern detection (client-side, no API call)
      const result = detectPayIDScamPatterns(concatenated);
      if (!result.isScam) return;

      // Inject chat warning banner if not already present
      if (chatContainer.querySelector(".arthur-chat-warning")) return;

      const banner = createChatWarningBanner(result.patterns);
      const messageList = chatContainer.querySelector(
        '[role="grid"], [role="log"], [data-pagelet*="ChatTab"]'
      );
      if (messageList) {
        messageList.insertAdjacentElement("beforebegin", banner);
      } else {
        chatContainer.prepend(banner);
      }

      // Optionally send to API for full Claude analysis
      try {
        chrome.runtime.sendMessage({
          type: "ANALYZE_MARKETPLACE",
          listingTitle: "",
          listingDescription: "",
          sellerName: "",
          landingUrl: null,
          imageUrls: [],
          context: "marketplace-chat",
          chatText: concatenated.slice(0, 5000),
        });
      } catch {
        // Silently fail — client-side warning is already shown
      }
    }

    // --- Route to correct handler ---
    function handleCurrentPage() {
      const mode = getPageMode();
      if (mode === "listing") {
        handleListingPage();
      } else if (mode === "chat") {
        handleChatPage();
      }
      // "browse" mode: no action for now (could scan listing cards in future)
    }

    // --- MutationObserver for SPA navigation ---
    function attachPageObserver() {
      pageObserver?.disconnect();
      pageObserver = new MutationObserver(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // Detect SPA navigation via URL change
          if (window.location.pathname !== lastPathname) {
            lastPathname = window.location.pathname;
            handleCurrentPage();
            return;
          }

          // For chat mode, re-scan on new messages
          const mode = getPageMode();
          if (mode === "chat") {
            handleChatPage();
          }
        }, 300);
      });
      pageObserver.observe(document.body, { childList: true, subtree: true });
    }

    // --- Heartbeat: re-check on SPA navigation ---
    setInterval(() => {
      if (window.location.pathname !== lastPathname) {
        lastPathname = window.location.pathname;
        handleCurrentPage();
      }
    }, 3000);

    // --- Start ---
    handleCurrentPage();
    attachPageObserver();
  },
});
