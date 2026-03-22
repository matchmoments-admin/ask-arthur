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
  phishing: "/illustrations/category-phishing.jpg",
  romance_scam: "/illustrations/category-romance-scam.jpg",
  investment_fraud: "/illustrations/category-investment-crypto.jpg",
  tech_support: "/illustrations/category-tech-support.jpg",
  impersonation: "/illustrations/category-impersonation.jpg",
  shopping_scam: "/illustrations/category-shopping-scam.jpg",
  phone_scam: "/illustrations/category-phone-sms.jpg",
  email_scam: "/illustrations/category-phishing.jpg",
  sms_scam: "/illustrations/category-phone-sms.jpg",
  employment_scam: "/illustrations/category-employment-scam.jpg",
  advance_fee: "/illustrations/category-advance-fee.jpg",
  rental_scam: "/illustrations/category-rental-scam.jpg",
  sextortion: "/illustrations/category-sextortion.jpg",
  informational: "/illustrations/category-default.jpg",
  other: "/illustrations/category-default.jpg",
};

export function getCategoryIllustration(category: string | null): string {
  if (category && CATEGORY_ILLUSTRATIONS[category]) {
    return CATEGORY_ILLUSTRATIONS[category];
  }
  return "/illustrations/category-default.jpg";
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
