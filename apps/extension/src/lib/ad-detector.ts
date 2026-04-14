export interface AdContent {
  advertiserName: string;
  adText: string;
  landingUrl: string | null;
  feedUnitElement: HTMLElement;
}

export interface AdAnalysisResult {
  verdict: "SAFE" | "SUSPICIOUS" | "HIGH_RISK";
  confidence: number;
  summary: string;
  redFlags: string[];
  urlMalicious: boolean;
  communityFlagCount: number;
}

/**
 * Checks if a feed unit is a sponsored/ad post using multiple detection methods.
 */
export function detectSponsoredPost(element: HTMLElement): boolean {
  // Method 1: Link-based — anchor tags with "/ads/about" href
  const links = element.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of links) {
    if (link.href.includes("/ads/about")) return true;
  }

  // Method 2: Text reconstruction — walk header DOM, filter hidden nodes, match "Sponsored"
  const headerArea = element.querySelector('[data-ad-preview="message"]')?.parentElement
    ?? element.querySelector("h4")?.closest("div")
    ?? element;

  const headerLinks = headerArea.querySelectorAll("a");
  for (const link of headerLinks) {
    const visibleText = getVisibleText(link);
    if (/^Sponsored$/i.test(visibleText.trim())) return true;
  }

  // Also check span elements that may contain "Sponsored" text
  const spans = headerArea.querySelectorAll("span");
  for (const span of spans) {
    if (span.children.length === 0) {
      const text = span.textContent?.trim() ?? "";
      if (/^Sponsored$/i.test(text)) {
        // Verify it's visible
        const style = getComputedStyle(span);
        if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
          return true;
        }
      }
    }
  }

  // Method 3: Structural — ad-specific data attributes and patterns
  if (element.querySelector("[data-ad-preview]")) return true;
  if (element.querySelector("[data-testid='ad_creative']")) return true;
  if (element.querySelector("a[aria-label='Sponsored']")) return true;

  return false;
}

/**
 * Walk DOM tree and reconstruct only visible text, filtering hidden nodes.
 */
function getVisibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const el = node as HTMLElement;
  const style = getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0" ||
    (style.width === "0px" && style.overflow === "hidden") ||
    (style.height === "0px" && style.overflow === "hidden")
  ) {
    return "";
  }

  let text = "";
  for (const child of el.childNodes) {
    text += getVisibleText(child);
  }
  return text;
}

/**
 * Extract ad content (advertiser name, ad copy, landing URL) from a feed unit.
 */
export function extractAdContent(feedUnit: HTMLElement): AdContent | null {
  // Advertiser name: usually the first strong/header link that is NOT "Sponsored"
  let advertiserName = "";
  const headerLinks = feedUnit.querySelectorAll<HTMLAnchorElement>("a[role='link'], h4 a, strong");
  for (const link of headerLinks) {
    const text = link.textContent?.trim() ?? "";
    if (text && !/^Sponsored$/i.test(text) && text.length > 1 && text.length < 100) {
      advertiserName = text;
      break;
    }
  }

  if (!advertiserName) return null;

  // Ad copy: concatenate text from [dir="auto"] containers
  const textContainers = feedUnit.querySelectorAll<HTMLElement>("[dir='auto']");
  const textParts: string[] = [];
  for (const container of textContainers) {
    const text = container.textContent?.trim() ?? "";
    if (text && text !== advertiserName && !/^Sponsored$/i.test(text) && text.length > 5) {
      textParts.push(text);
    }
  }

  const adText = textParts.join("\n").trim();
  if (!adText) return null;

  // Landing URL: CTA links (filter out facebook.com internal links)
  let landingUrl: string | null = null;
  const allLinks = feedUnit.querySelectorAll<HTMLAnchorElement>("a[href]");
  for (const link of allLinks) {
    try {
      const url = new URL(link.href);
      const hostname = url.hostname.toLowerCase();
      if (
        !hostname.includes("facebook.com") &&
        !hostname.includes("fb.com") &&
        !hostname.includes("fbcdn.net") &&
        url.protocol.startsWith("http")
      ) {
        landingUrl = link.href;
        break;
      }
      // Check l.facebook.com redirect links
      if (hostname === "l.facebook.com" && url.searchParams.has("u")) {
        landingUrl = url.searchParams.get("u");
        break;
      }
    } catch {
      // Ignore invalid URLs
    }
  }

  return {
    advertiserName,
    adText: adText.slice(0, 5000), // Cap length
    landingUrl,
    feedUnitElement: feedUnit,
  };
}

/**
 * Creates a compact shadow DOM warning banner for ads flagged as suspicious/high-risk.
 */
export function createWarningBanner(
  result: AdAnalysisResult,
  advertiserName: string,
  adTextHash?: string,
  landingUrl?: string | null
): HTMLElement {
  const host = document.createElement("div");
  host.className = "arthur-ad-banner";
  host.style.cssText = "position:relative;z-index:999;width:100%;";

  const shadow = host.attachShadow({ mode: "closed" });

  const isHighRisk = result.verdict === "HIGH_RISK";
  const borderColor = isHighRisk ? "#D32F2F" : "#F57C00";
  const bgColor = isHighRisk ? "rgba(211, 47, 47, 0.08)" : "rgba(245, 124, 0, 0.08)";
  const textColor = isHighRisk ? "#B71C1C" : "#E65100";
  const icon = isHighRisk ? "\u26D4" : "\u26A0\uFE0F";
  const title = isHighRisk ? "This ad may be a scam" : "This ad has suspicious characteristics";

  const flagsHtml = result.redFlags
    .slice(0, 2)
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join("");

  shadow.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .banner {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 16px;
        background: ${bgColor};
        border: 2px solid ${borderColor};
        border-radius: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #333;
        min-height: 52px;
        margin-bottom: 4px;
      }
      .icon { font-size: 22px; flex-shrink: 0; }
      .content { flex: 1; min-width: 0; }
      .title {
        font-weight: 700;
        font-size: 13px;
        color: ${textColor};
        margin-bottom: 2px;
      }
      .summary {
        font-size: 12px;
        color: #555;
        line-height: 1.4;
      }
      .flags {
        list-style: none;
        padding: 0;
        margin: 4px 0 0;
        font-size: 11px;
        color: #666;
      }
      .flags li::before {
        content: "\\2022 ";
        color: ${borderColor};
        font-weight: bold;
      }
      .actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .btn {
        padding: 5px 12px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid ${borderColor};
        background: white;
        color: ${textColor};
        transition: background 0.15s;
      }
      .btn:hover { background: ${bgColor}; }
      .btn-flag {
        background: ${borderColor};
        color: white;
        border-color: ${borderColor};
      }
      .btn-flag:hover { opacity: 0.9; background: ${borderColor}; }
      .advertiser {
        font-size: 11px;
        color: #999;
        margin-top: 2px;
      }
    </style>
    <div class="banner">
      <span class="icon">${icon}</span>
      <div class="content">
        <div class="title">${escapeHtml(title)}</div>
        <div class="summary">${escapeHtml(result.summary)}</div>
        ${flagsHtml ? `<ul class="flags">${flagsHtml}</ul>` : ""}
        <div class="advertiser">Advertiser: ${escapeHtml(advertiserName)}${result.communityFlagCount > 0 ? ` \u2022 ${result.communityFlagCount} community report${result.communityFlagCount > 1 ? "s" : ""}` : ""}</div>
      </div>
      <div class="actions">
        <button class="btn btn-flag" id="arthur-flag-btn">Flag This Ad</button>
      </div>
    </div>
  `;

  // Flag button dispatches custom event for the content script to handle
  shadow.getElementById("arthur-flag-btn")?.addEventListener("click", () => {
    document.dispatchEvent(
      new CustomEvent("arthur-flag-ad", {
        detail: {
          advertiserName,
          landingUrl: landingUrl ?? null,
          adTextHash: adTextHash ?? "",
        },
      })
    );
  });

  return host;
}

/**
 * Creates a small green safe indicator for SAFE ads (no banner).
 */
export function createSafeIndicator(): HTMLElement {
  const host = document.createElement("div");
  host.className = "arthur-ad-safe";
  host.style.cssText = "position:absolute;top:8px;right:8px;z-index:999;";

  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      .shield {
        width: 20px;
        height: 20px;
        background: #388E3C;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: white;
        opacity: 0.7;
        cursor: default;
        title: "Checked by Ask Arthur — appears safe";
      }
    </style>
    <div class="shield" title="Checked by Ask Arthur — appears safe">\u2713</div>
  `;

  return host;
}

/**
 * SHA-256 hash of normalized ad text for dedup and community flagging.
 */
export async function hashAdText(text: string): Promise<string> {
  const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");
  const data = new TextEncoder().encode(normalized);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
