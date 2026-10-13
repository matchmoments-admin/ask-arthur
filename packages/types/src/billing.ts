import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SubscriptionPlanSchema = z.enum([
  "pro",
  "business",
  "enterprise",
  "extension_pro",
  "mobile_premium",
  "bot_premium",
  // Brand Protection (Clone Watch monetisation, Wave 3) — billed on brands
  // monitored + takedown allotment, NOT API volume (kept out of TIER_LIMITS).
  "brand_monitor",
  "brand_monitor_plus",
  "brand_enterprise",
  // Sales-led partnership pilot (police / government / non-profit) — a deliberately
  // low, custom price to de-risk a first partnership and learn the buyer's needs.
  // Provisioned manually (billing_provider='manual') — never public self-serve.
  "brand_pilot",
]);
export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema>;

export const SubscriptionStatusSchema = z.enum([
  "active",
  "past_due",
  "canceled",
  "paused",
  "trialing",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

export const ApiTierSchema = z.enum(["free", "pro", "business", "enterprise", "custom"]);
export type ApiTier = z.infer<typeof ApiTierSchema>;

export const BillingProviderSchema = z.enum(["stripe", "manual"]);
export type BillingProvider = z.infer<typeof BillingProviderSchema>;

// ---------------------------------------------------------------------------
// Subscription (mirrors subscriptions DB table)
// ---------------------------------------------------------------------------

export interface Subscription {
  id: number;
  api_key_id: number;
  user_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  stripe_price_id: string | null;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  paused_at: string | null;
  billing_email: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// User profile (mirrors user_profiles DB table)
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  display_name: string | null;
  company_name: string | null;
  billing_email: string | null;
  stripe_customer_id: string | null;
  role: "user" | "admin";
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// API key (mirrors api_keys DB table)
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: number;
  key_hash: string;
  org_name: string;
  tier: ApiTier;
  is_active: boolean;
  daily_limit: number;
  rate_limit_per_minute: number;
  max_batch_size: number;
  allowed_endpoints: string[];
  user_id: string | null;
  org_id: string | null;
  created_at: string;
  last_used_at: string | null;
}

// ---------------------------------------------------------------------------
// Tier limits — new pricing (April 2026)
// ---------------------------------------------------------------------------

export interface TierLimit {
  requestsPerDay: number;
  requestsPerMinute: number;
  batchSize: number;
  apiKeys: number;
  orgSeats: number;
  monthlyPriceAud?: number;
  annualPriceAud?: number;
  /** Document Check B2B: POST /api/v1/document-checks per calendar month.
   *  0 = endpoint not available on this tier (402 upsell). Pricing research
   *  2026-08-21: Starter A$29→200 docs, Pro A$99→1,500 — mapped onto the
   *  existing tiers until dedicated doc SKUs ship. */
  documentChecksPerMonth: number;
}

export const TIER_LIMITS = {
  free: {
    requestsPerDay: 25,
    requestsPerMinute: 60,
    batchSize: 10,
    apiKeys: 1,
    orgSeats: 1,
    documentChecksPerMonth: 0,
  },
  pro: {
    requestsPerDay: 200,
    requestsPerMinute: 120,
    batchSize: 100,
    apiKeys: 3,
    orgSeats: 1,
    monthlyPriceAud: 99,
    annualPriceAud: 990,
    documentChecksPerMonth: 200,
  },
  business: {
    requestsPerDay: 2000,
    requestsPerMinute: 300,
    batchSize: 500,
    apiKeys: 10,
    orgSeats: 10,
    monthlyPriceAud: 449,
    annualPriceAud: 4490,
    documentChecksPerMonth: 1500,
  },
  enterprise: {
    requestsPerDay: 10000,
    requestsPerMinute: 500,
    batchSize: 2000,
    apiKeys: 999,
    orgSeats: 999,
    documentChecksPerMonth: 10000,
  },
  custom: {
    requestsPerDay: 25000,
    requestsPerMinute: 600,
    batchSize: 2000,
    apiKeys: 999,
    orgSeats: 999,
    documentChecksPerMonth: 25000,
  },
} as const;

// ---------------------------------------------------------------------------
// Extension tier limits (C4: freemium payment gate)
// ---------------------------------------------------------------------------

export interface ExtensionTierLimit {
  dailyChecks: number;
  burstPerMinute: number;
  /** Right-click "Check this image" Hive scans per install per day. The only
   *  per-unit-cost extension feature, so the free cap is deliberately small
   *  (taster) and the pro cap is the paid headroom. */
  imageChecksPerDay: number;
  urlGuard: boolean;
  emailScanning: boolean;
}

export const EXTENSION_TIER_LIMITS: Record<"free" | "pro", ExtensionTierLimit> = {
  free: {
    dailyChecks: 50,
    burstPerMinute: 10,
    imageChecksPerDay: 3,
    urlGuard: false,
    emailScanning: false,
  },
  pro: {
    dailyChecks: 500,
    burstPerMinute: 30,
    imageChecksPerDay: 30,
    urlGuard: true,
    emailScanning: true,
  },
} as const;

// ---------------------------------------------------------------------------
// Mobile tier limits
// ---------------------------------------------------------------------------

export interface MobileTierLimit {
  dailyChecks: number;
  offlineDB: boolean;
  pushAlerts: boolean;
  callScreening: boolean;
  smsFilter: boolean;
}

export const MOBILE_TIER_LIMITS: Record<"free" | "premium", MobileTierLimit> = {
  free: { dailyChecks: 25, offlineDB: false, pushAlerts: true, callScreening: false, smsFilter: false },
  premium: { dailyChecks: 500, offlineDB: true, pushAlerts: true, callScreening: true, smsFilter: true },
} as const;

// ---------------------------------------------------------------------------
// Brand Protection plans (Clone Watch monetisation, Wave 3)
// ---------------------------------------------------------------------------
// Billed on brands-monitored + takedown allotment, NOT API volume — a separate
// axis from TIER_LIMITS. `brand_pilot` is the sales-led partnership tier (first
// target: police) — a low, custom price to de-risk a first partnership and learn
// the buyer's needs; provisioned manually, never public self-serve checkout.

export type BrandPlanKey =
  | "brand_pilot"
  | "brand_monitor"
  | "brand_monitor_plus"
  | "brand_enterprise";

export interface BrandPlan {
  key: BrandPlanKey;
  name: string;
  /** Monthly price in AUD. null = custom / contact sales. */
  monthlyAud: number | null;
  /** Max brands monitored. null = portfolio / by agreement. */
  brands: number | null;
  /** Included managed takedowns per month. null = not capped (#1295: counted
   *  and shown, never capped yet). */
  takedownsPerMonth: number | null;
  /** Sales motion — self-serve checkout vs contact/partnership. */
  motion: "self_serve" | "contact" | "partnership";
  /** Shown on the public pricing page? (#1295: only the pilot, until the
   *  first customer.) */
  public: boolean;
  blurb: string;
}

export const BRAND_PLANS: Record<BrandPlanKey, BrandPlan> = {
  // #1295 (founder, 2026-10-13): sell ONLY the manual A$300 pilot until the
  // first customer; the self-serve tiers are hidden (public: false) and pricing
  // stays in fog. Blurbs promise only what the entitlement Module
  // (apps/web/lib/clone-watch/brand-subscriber.ts) enforces. Managed takedowns
  // are counted, not capped — takedownsPerMonth is null on every plan.
  brand_pilot: {
    key: "brand_pilot",
    name: "Brand Protection Pilot",
    monthlyAud: 300,
    brands: 1,
    takedownsPerMonth: null,
    motion: "partnership",
    public: true,
    blurb:
      "One brand, set up by hand with you. Daily priority rescans of its live lookalikes, an urgent alert when one starts serving phishing, a monthly evidence report, and managed takedown escalation.",
  },
  brand_monitor: {
    key: "brand_monitor",
    name: "Brand Monitor",
    monthlyAud: 1950,
    brands: 1,
    takedownsPerMonth: null,
    motion: "self_serve",
    public: false,
    blurb:
      "One brand: daily priority rescans of its live lookalikes, urgent weaponised-lookalike alerts, a monthly evidence report and managed takedown escalation.",
  },
  brand_monitor_plus: {
    key: "brand_monitor_plus",
    name: "Brand Monitor+",
    monthlyAud: 2950,
    brands: 3,
    takedownsPerMonth: null,
    motion: "self_serve",
    public: false,
    blurb:
      "Up to three brands, each with daily priority rescans, urgent weaponised-lookalike alerts, a monthly evidence report and managed takedown escalation.",
  },
  brand_enterprise: {
    key: "brand_enterprise",
    name: "Enterprise",
    monthlyAud: null,
    brands: null,
    takedownsPerMonth: null,
    motion: "contact",
    public: false,
    blurb:
      "A portfolio of brands, by agreement.",
  },
} as const;
