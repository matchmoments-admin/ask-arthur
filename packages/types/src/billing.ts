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

export const BillingProviderSchema = z.enum(["paddle", "stripe", "manual"]);
export type BillingProvider = z.infer<typeof BillingProviderSchema>;

// ---------------------------------------------------------------------------
// Subscription (mirrors subscriptions DB table)
// ---------------------------------------------------------------------------

export interface Subscription {
  id: number;
  api_key_id: number;
  user_id: string | null;
  // Paddle fields (nullable for Stripe records)
  paddle_subscription_id: string | null;
  paddle_customer_id: string | null;
  paddle_price_id: string | null;
  // Stripe fields (nullable for Paddle records)
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  stripe_price_id: string | null;
  billing_provider: BillingProvider;
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
}

export const TIER_LIMITS = {
  free: {
    requestsPerDay: 25,
    requestsPerMinute: 60,
    batchSize: 10,
    apiKeys: 1,
    orgSeats: 1,
  },
  pro: {
    requestsPerDay: 200,
    requestsPerMinute: 120,
    batchSize: 100,
    apiKeys: 3,
    orgSeats: 1,
    monthlyPriceAud: 99,
    annualPriceAud: 990,
  },
  business: {
    requestsPerDay: 2000,
    requestsPerMinute: 300,
    batchSize: 500,
    apiKeys: 10,
    orgSeats: 10,
    monthlyPriceAud: 449,
    annualPriceAud: 4490,
  },
  enterprise: {
    requestsPerDay: 10000,
    requestsPerMinute: 500,
    batchSize: 2000,
    apiKeys: 999,
    orgSeats: 999,
  },
  custom: {
    requestsPerDay: 25000,
    requestsPerMinute: 600,
    batchSize: 2000,
    apiKeys: 999,
    orgSeats: 999,
  },
} as const;

// ---------------------------------------------------------------------------
// Extension tier limits (C4: freemium payment gate)
// ---------------------------------------------------------------------------

export interface ExtensionTierLimit {
  dailyChecks: number;
  burstPerMinute: number;
  urlGuard: boolean;
  emailScanning: boolean;
}

export const EXTENSION_TIER_LIMITS: Record<"free" | "pro", ExtensionTierLimit> = {
  free: { dailyChecks: 50, burstPerMinute: 10, urlGuard: false, emailScanning: false },
  pro: { dailyChecks: 500, burstPerMinute: 30, urlGuard: true, emailScanning: true },
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
