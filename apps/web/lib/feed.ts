export const CATEGORY_CONFIG: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  phishing: { icon: "Fish", color: "#EF4444", label: "Phishing" },
  romance_scam: { icon: "HeartCrack", color: "#EC4899", label: "Romance Scam" },
  investment_fraud: { icon: "TrendingUp", color: "#F59E0B", label: "Investment Fraud" },
  tech_support: { icon: "Monitor", color: "#6B7280", label: "Tech Support" },
  impersonation: { icon: "Theater", color: "#F97316", label: "Impersonation" },
  shopping_scam: { icon: "ShoppingBag", color: "#8B5CF6", label: "Shopping Scam" },
  phone_scam: { icon: "Phone", color: "#3B82F6", label: "Phone Scam" },
  email_scam: { icon: "Mail", color: "#8B5CF6", label: "Email Scam" },
  sms_scam: { icon: "MessageSquare", color: "#06B6D4", label: "SMS Scam" },
  employment_scam: { icon: "Briefcase", color: "#10B981", label: "Employment Scam" },
  advance_fee: { icon: "Banknote", color: "#F59E0B", label: "Advance Fee" },
  rental_scam: { icon: "Home", color: "#8B5CF6", label: "Rental Scam" },
  sextortion: { icon: "ShieldAlert", color: "#DC2626", label: "Sextortion" },
  informational: { icon: "Info", color: "#6B7280", label: "Informational" },
  other: { icon: "AlertTriangle", color: "#9CA3AF", label: "Scam Alert" },
};

export const SOURCE_CONFIG: Record<
  string,
  { label: string; icon: string }
> = {
  reddit: { label: "Reddit", icon: "MessageCircle" },
  user_report: { label: "Reported", icon: "Flag" },
  verified_scam: { label: "Verified", icon: "ShieldCheck" },
  scamwatch: { label: "Scamwatch", icon: "Shield" },
};

export const COUNTRY_OPTIONS = [
  { value: "", label: "All Countries" },
  { value: "AU", label: "Australia" },
  { value: "US", label: "United States" },
  { value: "GB", label: "United Kingdom" },
  { value: "CA", label: "Canada" },
  { value: "NZ", label: "New Zealand" },
  { value: "IN", label: "India" },
  { value: "SG", label: "Singapore" },
] as const;

export const COUNTRY_FLAGS: Record<string, string> = {
  AU: "\u{1F1E6}\u{1F1FA}",
  US: "\u{1F1FA}\u{1F1F8}",
  GB: "\u{1F1EC}\u{1F1E7}",
  CA: "\u{1F1E8}\u{1F1E6}",
  NZ: "\u{1F1F3}\u{1F1FF}",
  IN: "\u{1F1EE}\u{1F1F3}",
  SG: "\u{1F1F8}\u{1F1EC}",
  DE: "\u{1F1E9}\u{1F1EA}",
  FR: "\u{1F1EB}\u{1F1F7}",
  JP: "\u{1F1EF}\u{1F1F5}",
  CN: "\u{1F1E8}\u{1F1F3}",
  BR: "\u{1F1E7}\u{1F1F7}",
  MX: "\u{1F1F2}\u{1F1FD}",
  ZA: "\u{1F1FF}\u{1F1E6}",
  NG: "\u{1F1F3}\u{1F1EC}",
  PH: "\u{1F1F5}\u{1F1ED}",
  ID: "\u{1F1EE}\u{1F1E9}",
  MY: "\u{1F1F2}\u{1F1FE}",
  TH: "\u{1F1F9}\u{1F1ED}",
  VN: "\u{1F1FB}\u{1F1F3}",
  KR: "\u{1F1F0}\u{1F1F7}",
  AE: "\u{1F1E6}\u{1F1EA}",
  SA: "\u{1F1F8}\u{1F1E6}",
  IT: "\u{1F1EE}\u{1F1F9}",
  ES: "\u{1F1EA}\u{1F1F8}",
  NL: "\u{1F1F3}\u{1F1F1}",
  SE: "\u{1F1F8}\u{1F1EA}",
  PK: "\u{1F1F5}\u{1F1F0}",
  BD: "\u{1F1E7}\u{1F1E9}",
  TR: "\u{1F1F9}\u{1F1F7}",
};

/**
 * Display names for country codes used in the Top Countries highlights panel.
 * Covers the countries likely to appear in the top-5 list over time.
 * For codes not in the map, consumers should fall back to the code string itself.
 */
export const COUNTRY_NAMES: Record<string, string> = {
  AU: "Australia",
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  NZ: "New Zealand",
  IN: "India",
  SG: "Singapore",
  DE: "Germany",
  FR: "France",
  JP: "Japan",
  CN: "China",
  BR: "Brazil",
  MX: "Mexico",
  ZA: "South Africa",
  NG: "Nigeria",
  PH: "Philippines",
  ID: "Indonesia",
  MY: "Malaysia",
  TH: "Thailand",
  VN: "Vietnam",
  KR: "South Korea",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  SE: "Sweden",
  PK: "Pakistan",
  BD: "Bangladesh",
  TR: "Turkey",
};

export type FeedItem = {
  id: number;
  source: string;
  external_id: string | null;
  title: string;
  description: string | null;
  url: string | null;
  source_url: string | null;
  category: string | null;
  channel: string | null;
  r2_image_key: string | null;
  reddit_image_url: string | null;
  has_image: boolean;
  impersonated_brand: string | null;
  country_code: string | null;
  upvotes: number;
  verified: boolean;
  published: boolean;
  created_at: string;
  source_created_at: string | null;
};

const CATEGORY_ILLUSTRATIONS: Record<string, string> = {
  phishing: "/illustrations/category-phishing.webp",
  romance_scam: "/illustrations/category-romance-scam.webp",
  investment_fraud: "/illustrations/category-investment-crypto.webp",
  tech_support: "/illustrations/category-tech-support.webp",
  impersonation: "/illustrations/category-impersonation.webp",
  shopping_scam: "/illustrations/category-shopping-scam.webp",
  phone_scam: "/illustrations/category-phone-sms.webp",
  email_scam: "/illustrations/category-phishing.webp",
  sms_scam: "/illustrations/category-phone-sms.webp",
  employment_scam: "/illustrations/category-employment-scam.webp",
  advance_fee: "/illustrations/category-advance-fee.webp",
  rental_scam: "/illustrations/category-rental-scam.webp",
  sextortion: "/illustrations/category-sextortion.webp",
  informational: "/illustrations/category-default.webp",
  other: "/illustrations/category-default.webp",
};

export function getCategoryIllustration(category: string | null): string {
  if (category && CATEGORY_ILLUSTRATIONS[category]) {
    return CATEGORY_ILLUSTRATIONS[category];
  }
  return "/illustrations/category-default.webp";
}

export function getImageUrl(item: FeedItem): string | null {
  if (item.r2_image_key) {
    const cdnUrl = process.env.NEXT_PUBLIC_CDN_URL;
    if (cdnUrl) return `${cdnUrl}/${item.r2_image_key}`;
  }
  if (item.reddit_image_url) {
    return `/api/feed/proxy-image?url=${encodeURIComponent(item.reddit_image_url)}`;
  }
  return null;
}

export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;

  return new Date(dateStr).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}
