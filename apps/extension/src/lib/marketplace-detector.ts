import { EXT_COLORS } from "./extension-colors";

// --- Types ---

export interface SellerProfile {
  name: string;
  joinDate: string | null;
  ratingCount: number | null;
  averageRating: number | null;
  responseTime: string | null;
  location: string | null;
  isNewAccount: boolean;
}

export interface MarketplaceListing {
  title: string;
  price: string | null;
  description: string;
  location: string | null;
  seller: SellerProfile;
  imageUrls: string[];
  listingUrl: string;
}

export interface TrustScore {
  score: number; // 0-100
  level: "trusted" | "caution" | "warning";
  factors: string[];
}

// --- Seller extraction ---

export function extractSellerProfile(container: HTMLElement): SellerProfile {
  let name = "";
  const profileLinks = container.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/marketplace/profile/"]'
  );
  for (const link of profileLinks) {
    const text = link.textContent?.trim() ?? "";
    if (text && text.length > 1 && text.length < 100) {
      name = text;
      break;
    }
  }

  // Join date: walk text nodes looking for "Joined in YYYY" or "Joined Facebook in YYYY"
  let joinDate: string | null = null;
  let isNewAccount = false;
  const allText = container.innerText ?? "";
  const joinMatch = allText.match(/Joined\s+(?:Facebook\s+)?in\s+(\d{4})/i);
  if (joinMatch) {
    joinDate = joinMatch[1];
    const joinYear = parseInt(joinMatch[1], 10);
    const currentYear = new Date().getFullYear();
    isNewAccount = currentYear - joinYear < 2;
  }

  // Ratings count
  let ratingCount: number | null = null;
  const ratingMatch = allText.match(/(\d+)\s+ratings?/i);
  if (ratingMatch) {
    ratingCount = parseInt(ratingMatch[1], 10);
  }

  // Average rating
  let averageRating: number | null = null;
  const avgMatch = allText.match(/(\d\.?\d?)\s*(?:out of 5|stars?)/i);
  if (avgMatch) {
    averageRating = parseFloat(avgMatch[1]);
  }

  // Response time
  let responseTime: string | null = null;
  const responseMatch = allText.match(/Typically responds\s+[\w\s]+/i);
  if (responseMatch) {
    responseTime = responseMatch[0].trim();
  }

  // Location near seller section
  let location: string | null = null;
  const locationMatch = allText.match(
    /(?:Lives in|Located in|From)\s+([A-Za-z\s,]+)/i
  );
  if (locationMatch) {
    location = locationMatch[1].trim();
  }

  return {
    name,
    joinDate,
    ratingCount,
    averageRating,
    responseTime,
    location,
    isNewAccount,
  };
}

// --- Listing extraction ---

export function extractMarketplaceListing(
  page: HTMLElement
): MarketplaceListing | null {
  // Title: first large heading
  let title = "";
  const heading =
    page.querySelector<HTMLElement>("h1") ??
    page.querySelector<HTMLElement>('[role="heading"]');
  if (heading) {
    title = heading.textContent?.trim() ?? "";
  }
  if (!title) return null;

  // Price: look for $ followed by digits, or aria-label containing "Price"
  let price: string | null = null;
  const priceEl = page.querySelector<HTMLElement>('[aria-label*="Price"]');
  if (priceEl) {
    price = priceEl.textContent?.trim() ?? null;
  }
  if (!price) {
    const allText = page.innerText ?? "";
    const priceMatch = allText.match(/\$[\d,]+(?:\.\d{2})?/);
    if (priceMatch) {
      price = priceMatch[0];
    }
  }

  // Description: longest [dir="auto"] text block (>20 chars, not the title)
  let description = "";
  const textContainers = page.querySelectorAll<HTMLElement>('[dir="auto"]');
  for (const el of textContainers) {
    const text = el.textContent?.trim() ?? "";
    if (text.length > 20 && text !== title && text.length > description.length) {
      description = text;
    }
  }

  // Location: text near "Listed in" or pickup location
  let location: string | null = null;
  const pageText = page.innerText ?? "";
  const listedMatch = pageText.match(
    /(?:Listed in|Pick up in|Pickup in|Available in)\s+([A-Za-z\s,]+)/i
  );
  if (listedMatch) {
    location = listedMatch[1].trim();
  }

  // Images: Facebook CDN images >= 200px
  const imageUrls: string[] = [];
  const images = page.querySelectorAll<HTMLImageElement>(
    'img[src*="scontent"], img[src*="fbcdn"]'
  );
  for (const img of images) {
    if (img.naturalWidth >= 200 && !imageUrls.includes(img.src)) {
      imageUrls.push(img.src);
    }
  }

  const seller = extractSellerProfile(page);

  return {
    title,
    price,
    description: description.slice(0, 5000),
    location,
    seller,
    imageUrls: imageUrls.slice(0, 10),
    listingUrl: window.location.href,
  };
}

// --- Trust scoring ---

export function computeTrustScore(
  seller: SellerProfile,
  listing: MarketplaceListing
): TrustScore {
  let score = 70;
  const factors: string[] = [];

  if (seller.isNewAccount) {
    score -= 25;
    factors.push("New account (joined recently)");
  }
  if (seller.joinDate === null) {
    score -= 15;
    factors.push("Account age unknown");
  }
  if (seller.ratingCount === 0 || seller.ratingCount === null) {
    score -= 20;
    factors.push("No seller ratings");
  } else if (seller.ratingCount > 10) {
    score += 10;
    factors.push(`${seller.ratingCount} ratings`);
  }
  if (seller.averageRating !== null && seller.averageRating < 3.5) {
    score -= 15;
    factors.push(`Low rating: ${seller.averageRating}/5`);
  }
  if (
    seller.location &&
    listing.location &&
    seller.location.toLowerCase() !== listing.location.toLowerCase()
  ) {
    score -= 10;
    factors.push("Seller location doesn't match listing location");
  }

  const clampedScore = Math.max(0, Math.min(100, score));

  return {
    score: clampedScore,
    level:
      clampedScore >= 70 ? "trusted" : clampedScore >= 40 ? "caution" : "warning",
    factors,
  };
}

// --- Trust badge (Shadow DOM) ---

export function createTrustBadge(
  trust: TrustScore,
  sellerName: string
): HTMLElement {
  const host = document.createElement("div");
  host.className = "arthur-trust-badge";
  host.style.cssText = "position:relative;z-index:999;display:inline-block;";

  const shadow = host.attachShadow({ mode: "closed" });

  const isWarning = trust.level === "warning";
  const isCaution = trust.level === "caution";
  const isTrusted = trust.level === "trusted";

  const palette = isWarning
    ? EXT_COLORS.highRisk
    : isCaution
      ? EXT_COLORS.suspicious
      : EXT_COLORS.safe;
  const bgColor = isWarning
    ? "rgba(211, 47, 47, 0.12)"
    : isCaution
      ? "rgba(245, 124, 0, 0.12)"
      : "rgba(56, 142, 60, 0.12)";
  const borderColor = palette.border;
  const textColor = isWarning
    ? palette.text
    : isCaution
      ? palette.text
      : "#2E7D32";
  const icon = isWarning ? "\u26D4" : isCaution ? "\u26A0\uFE0F" : "\u2705";
  const label = isWarning
    ? "High-risk seller"
    : isCaution
      ? "Exercise caution"
      : "Seller verified by Ask Arthur";

  const factorsHtml = trust.factors
    .slice(0, 4)
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join("");

  shadow.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: ${bgColor};
        border: 1.5px solid ${borderColor};
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 12px;
        color: ${textColor};
        font-weight: 600;
        max-width: 340px;
        line-height: 1.4;
      }
      .icon { font-size: 16px; flex-shrink: 0; }
      .content { flex: 1; min-width: 0; }
      .label { white-space: nowrap; }
      .factors {
        list-style: none;
        padding: 0;
        margin: 3px 0 0;
        font-size: 11px;
        font-weight: 400;
        color: #555;
      }
      .factors li::before {
        content: "\\2022 ";
        color: ${borderColor};
        font-weight: bold;
      }
      .seller {
        font-size: 10px;
        color: #999;
        margin-top: 2px;
      }
      ${
        isTrusted
          ? `.badge { cursor: default; } .badge:hover .tooltip { display: block; }
         .tooltip { display: none; position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
           background: #333; color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 11px; white-space: nowrap; margin-bottom: 4px; }`
          : ""
      }
    </style>
    <div class="badge">
      <span class="icon">${icon}</span>
      <div class="content">
        <span class="label">${escapeHtml(label)}</span>
        ${factorsHtml ? `<ul class="factors">${factorsHtml}</ul>` : ""}
        ${!isTrusted ? `<div class="seller">${escapeHtml(sellerName)}</div>` : ""}
      </div>
      ${isTrusted ? `<span class="tooltip">Score: ${trust.score}/100</span>` : ""}
    </div>
  `;

  return host;
}

// --- PayID scam pattern detection ---

const PAYID_PATTERNS = [
  {
    pattern: /payid.*(?:upgrade|business\s*account|merchant\s*limit|pending)/i,
    label: "PayID upgrade/limit scam",
  },
  {
    pattern:
      /(?:sister|brother|relative|friend|partner).*(?:collect|pick\s*up)/i,
    label: "Relative will collect pattern",
  },
  {
    pattern: /(?:payid|payment).*(?:gmail|outlook|hotmail|yahoo)/i,
    label: "Non-bank PayID confirmation",
  },
  {
    pattern:
      /(?:whatsapp|text\s*me|email\s*me|call\s*me\s*on).*(?:instead|rather|better)/i,
    label: "Moving off-platform",
  },
  {
    pattern: /(?:overpay|over\s*pay|refund.*difference|sent.*too\s*much)/i,
    label: "Overpayment refund scam",
  },
  {
    pattern: /(?:facebook\s*payment\s*portal|fb\s*payment)/i,
    label: "Fake Facebook payment portal",
  },
];

export function detectPayIDScamPatterns(text: string): {
  isScam: boolean;
  patterns: string[];
} {
  const hits = PAYID_PATTERNS.filter((p) => p.pattern.test(text));
  return { isScam: hits.length > 0, patterns: hits.map((h) => h.label) };
}

// --- Chat warning banner (Shadow DOM) ---

export function createChatWarningBanner(patterns: string[]): HTMLElement {
  const host = document.createElement("div");
  host.className = "arthur-chat-warning";
  host.style.cssText = "position:relative;z-index:999;width:100%;";

  const shadow = host.attachShadow({ mode: "closed" });

  const patternsHtml = patterns
    .map((p) => `<li>${escapeHtml(p)}</li>`)
    .join("");

  shadow.innerHTML = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      .banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 16px;
        background: ${EXT_COLORS.highRisk.bg};
        border: 2px solid ${EXT_COLORS.highRisk.border};
        border-radius: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        color: #333;
        margin: 8px 0;
      }
      .icon { font-size: 20px; flex-shrink: 0; margin-top: 1px; }
      .content { flex: 1; min-width: 0; }
      .title {
        font-weight: 700;
        font-size: 13px;
        color: ${EXT_COLORS.highRisk.text};
        margin-bottom: 4px;
      }
      .patterns {
        list-style: none;
        padding: 0;
        margin: 0 0 6px;
        font-size: 12px;
        color: #555;
      }
      .patterns li::before {
        content: "\\26A0 ";
        color: ${EXT_COLORS.highRisk.border};
      }
      .advice {
        font-size: 11px;
        color: #666;
        font-style: italic;
        line-height: 1.4;
      }
      .branding {
        font-size: 10px;
        color: #999;
        margin-top: 4px;
      }
    </style>
    <div class="banner">
      <span class="icon">\u26D4</span>
      <div class="content">
        <div class="title">Potential scam patterns detected</div>
        <ul class="patterns">${patternsHtml}</ul>
        <div class="advice">PayID never sends emails — verify payments through your banking app only.</div>
        <div class="branding">Protected by Ask Arthur</div>
      </div>
    </div>
  `;

  return host;
}

// --- Helpers ---

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
