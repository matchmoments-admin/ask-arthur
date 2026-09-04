export const CATEGORY_CONFIG: Record<
  string,
  { icon: string; color: string; label: string }
> = {
  phishing: { icon: "Fish", color: "#EF4444", label: "Phishing" },
  romance_scam: { icon: "HeartCrack", color: "#EC4899", label: "Romance Scam" },
  investment_fraud: {
    icon: "TrendingUp",
    color: "#F59E0B",
    label: "Investment Fraud",
  },
  tech_support: { icon: "Monitor", color: "#6B7280", label: "Tech Support" },
  impersonation: { icon: "Theater", color: "#F97316", label: "Impersonation" },
  shopping_scam: {
    icon: "ShoppingBag",
    color: "#8B5CF6",
    label: "Shopping Scam",
  },
  phone_scam: { icon: "Phone", color: "#3B82F6", label: "Phone Scam" },
  email_scam: { icon: "Mail", color: "#8B5CF6", label: "Email Scam" },
  sms_scam: { icon: "MessageSquare", color: "#06B6D4", label: "SMS Scam" },
  employment_scam: {
    icon: "Briefcase",
    color: "#10B981",
    label: "Employment Scam",
  },
  advance_fee: { icon: "Banknote", color: "#F59E0B", label: "Advance Fee" },
  rental_scam: { icon: "Home", color: "#8B5CF6", label: "Rental Scam" },
  sextortion: { icon: "ShieldAlert", color: "#DC2626", label: "Sextortion" },
  informational: { icon: "Info", color: "#6B7280", label: "Informational" },
  other: { icon: "AlertTriangle", color: "#9CA3AF", label: "Scam Alert" },
};

export const SOURCE_CONFIG: Record<
  string,
  { label: string; icon: string; isRegulator?: boolean }
> = {
  reddit: { label: "Reddit", icon: "MessageCircle" },
  user_report: { label: "Reported", icon: "Flag" },
  verified_scam: { label: "Verified", icon: "ShieldCheck" },
  scamwatch: { label: "Scamwatch", icon: "Shield" },
  // Regulator narrative sources — surfaced with a "Regulator" pill in
  // FeedCard so they're visually distinct from user-generated content.
  scamwatch_alert: {
    label: "ACCC Scamwatch",
    icon: "Shield",
    isRegulator: true,
  },
  acsc: { label: "ASD ACSC", icon: "Shield", isRegulator: true },
  asic_investor: { label: "ASIC", icon: "Shield", isRegulator: true },
  // Phase B narrative scrapers (austrac shipping in PR-B3 #247).
  austrac: { label: "AUSTRAC", icon: "Shield", isRegulator: true },
  // Inbound-email newsletter sources (Cloudflare Email Routing → Worker →
  // intel-inbound-email Edge Function). These live behind the per-source
  // auto_publish gate; until a row is promoted by the classifier (P3) or
  // an operator, it stays published=false and never appears here. The
  // labels render only when the gate flips a row to published=true.
  inbound_scamwatch: {
    label: "ACCC Scamwatch",
    icon: "Shield",
    isRegulator: true,
  },
  inbound_acsc: { label: "ASD ACSC", icon: "Shield", isRegulator: true },
  inbound_austrac: { label: "AUSTRAC", icon: "Shield", isRegulator: true },
  inbound_oaic: { label: "OAIC", icon: "Shield", isRegulator: true },
  inbound_afp: { label: "AFP", icon: "Shield", isRegulator: true },
  inbound_acma: { label: "ACMA", icon: "Shield", isRegulator: true },
  inbound_ato: { label: "ATO", icon: "Shield", isRegulator: true },
  inbound_ftc: { label: "FTC", icon: "Shield", isRegulator: true },
  inbound_idcare: { label: "IDCARE", icon: "Shield" },
  inbound_auscert: { label: "AusCERT", icon: "Shield" },
  inbound_krebs: { label: "Krebs on Security", icon: "Mail" },
  inbound_sans: { label: "SANS NewsBites", icon: "Mail" },
  inbound_tldr_infosec: { label: "TLDR Infosec", icon: "Mail" },
  inbound_thn: { label: "The Hacker News", icon: "Mail" },
  inbound_securityweek: { label: "SecurityWeek", icon: "Mail" },
  inbound_riskybiz: { label: "Risky Business", icon: "Mail" },
  inbound_generic: { label: "Newsletter", icon: "Mail" },
  // Arthur's Watch competitor scam-newsletters (v209/v213) — ingest-but-never-
  // publish (ADR-0021), so these never actually render on the public feed;
  // registered here to satisfy the source-config drift guard and label them
  // correctly if that ever changes.
  inbound_which_scams: { label: "Which? Scam Alerts", icon: "Mail" },
  inbound_aarp_fraud: { label: "AARP Fraud Watch", icon: "Mail" },
  inbound_mse: { label: "MoneySavingExpert", icon: "Mail" },
  inbound_frankonfraud: { label: "FrankonFraud", icon: "Mail" },
  inbound_choice_au: { label: "CHOICE", icon: "Mail" },
  inbound_nts_scams: { label: "NTS Scams Team", icon: "Mail" },
  inbound_cyber_safe_center: { label: "Cyber Safe Center", icon: "Mail" },
  inbound_fraud_hq: { label: "Fraud HQ", icon: "Mail" },
  inbound_get_safe_online: { label: "Get Safe Online", icon: "Mail" },
  // WA ScamNet (v213) — AU state regulator. Ingest-only since #807 (WA
  // Crown-copyright bars commercial reproduction): items land quarantined as
  // category='competitor_intel', so this label never renders on the public
  // feed — kept for admin surfaces only.
  inbound_wa_scamnet: {
    label: "WA ScamNet",
    icon: "Shield",
    isRegulator: true,
  },
};

// Humanise an unregistered source slug for the fallback label so the UI
// never silently impersonates one of the known sources (the old fallback
// was SOURCE_CONFIG.reddit, which made every austrac / inbound_* row
// render as "Reddit" before this source-config was added).
export function humanizeSource(slug: string): string {
  return slug
    .replace(/^inbound_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

/**
 * The columns the public feed exposes — the single source of truth for both
 * `/api/feed` and the server-side loaders, and deliberately the same list as
 * the `FeedItem` type below.
 *
 * This exists because both readers used `select("*")`, which is not a
 * shortcut but a decision to publish every column the table ever grows. Two
 * were being served to the public that should never have been:
 *
 *   body_md    — the fuller source text, held for ANALYSIS ONLY. Measured on
 *                the live site before this fix: /api/feed returned 282 chars
 *                of it for id 42321. Once the scraper stores full Reddit post
 *                bodies (v299) that would have published every one of them,
 *                which both migration-v299 and the privacy-impact assessment
 *                state is impossible. migration-v302 revoked the column from
 *                `anon`, but these readers use the SERVICE client, and
 *                service_role bypasses column grants — so the migration
 *                closed the PostgREST door and left our own front door open.
 *   embedding  — a 1024-dimension vector, ~12.5 KB per row, of no use to any
 *                client and a meaningful share of the payload.
 *
 * Adding a column to feed_items no longer publishes it by accident: it has to
 * be named here, and `apps/web/__tests__/feedApiContract.test.ts` asserts the
 * two lists agree.
 */
// Must stay ONE string literal on one line. TypeScript widens `"a" + "b"` to
// `string`, and supabase-js infers the row type from the literal — a widened
// value silently degrades every caller's result to GenericStringError[].
/**
 * Take summary joined onto a feed row.
 *
 * A separate constant, not appended to FEED_ITEM_SELECT, because the join is
 * only paid for when the cards flag is on — the feed is the highest-traffic
 * surface in the app and the base query must stay exactly as cheap as it was.
 *
 * Only what a CARD needs: enough to render a chip and decide whether to link.
 * The tells and prose live on the detail page, so the list payload does not
 * carry text nobody reads.
 */
export const FEED_TAKE_JOIN =
  "reddit_post_intel(take_status, take_tells, intent_label, confidence)";

export const FEED_ITEM_SELECT =
  "id, source, external_id, title, description, url, source_url, category, channel, r2_image_key, reddit_image_url, has_image, impersonated_brand, country_code, upvotes, verified, published, created_at, source_created_at";

/**
 * Derived from the select string rather than the other way round: supabase-js
 * infers a row's TYPE from the string literal passed to `.select()`, so a
 * value built by `.join()` degrades the result to GenericStringError[]. The
 * literal has to be the source; this array exists for the contract test.
 */
export const FEED_ITEM_COLUMNS = FEED_ITEM_SELECT.split(", ");

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
  /**
   * Present only when the cards flag is on AND the row has a take. Optional so
   * every existing consumer keeps compiling and rendering unchanged.
   */
  reddit_post_intel?: {
    take_status: string | null;
    take_tells: string[] | null;
    intent_label: string | null;
    confidence: number | null;
  } | null;
};

/**
 * Does this row have a take good enough to send a reader to its page?
 *
 * Delegates to takeIsPageWorthy — ONE implementation of the rule. An earlier
 * version reimplemented it here because FeedCard is a client component and the
 * loader is "server-only", and kept the two honest with a test asserting they
 * agree. A test that two copies match is a guard, not a fix: the rule now
 * lives in this module, which both sides already import.
 */
export function feedItemHasTake(item: FeedItem): boolean {
  const t = item.reddit_post_intel;
  if (!t) return false;
  return takeIsPageWorthy({
    takeStatus: t.take_status,
    tells: t.take_tells,
    confidence: t.confidence,
  });
}

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

/**
 * A shareable URL that says what it is: `42117-fake-brand-collab`.
 *
 * Resolution is on the LEADING NUMERIC ID only, so the readable suffix can be
 * regenerated — or the title corrected — without breaking a link someone has
 * already shared or cited. Same approach Reddit and Stack Overflow use.
 */
export function takeSlug(feedItemId: number, title: string): string {
  const words = title
    .toLowerCase()
    .replace(/\[[a-z]{2,3}\]/g, " ") // country tags like [US] carry nothing
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join("-");
  return words ? `${feedItemId}-${words}` : String(feedItemId);
}

/** The leading integer of a slug, or null when the segment is not one. */
export function parseFeedItemId(slug: string): number | null {
  const m = /^(\d+)(?:-|$)/.exec(slug);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * The substance bar for having a page at all.
 *
 * Not every ready take earns a URL. A take with one thin tell is a worse
 * advert for the analysis than no page: six thousand near-duplicate pages of
 * three bullets is a search liability, and it undercuts the "this is a serious
 * analytical corpus" impression the page exists to create. Two tells and
 * reasonable confidence is the floor.
 *
 * Exported because the sitemap must enumerate exactly the same set — if the
 * two ever disagree, the sitemap advertises 404s.
 */
export const TAKE_PAGE_MIN_TELLS = 2;
export const TAKE_PAGE_MIN_CONFIDENCE = 0.7;

export function takeIsPageWorthy(row: {
  takeStatus: string | null;
  tells: string[] | null;
  confidence: number | null;
}): boolean {
  return (
    row.takeStatus === "ready" &&
    (row.tells?.length ?? 0) >= TAKE_PAGE_MIN_TELLS &&
    (row.confidence ?? 0) >= TAKE_PAGE_MIN_CONFIDENCE
  );
}
