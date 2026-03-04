import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SubscriptionPlanSchema = z.enum([
  "pro",
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

export const ApiTierSchema = z.enum(["free", "pro", "enterprise"]);
export type ApiTier = z.infer<typeof ApiTierSchema>;

// ---------------------------------------------------------------------------
// Subscription (mirrors subscriptions DB table)
// ---------------------------------------------------------------------------

export interface Subscription {
  id: number;
  api_key_id: number;
  user_id: string | null;
  paddle_subscription_id: string;
  paddle_customer_id: string;
  paddle_price_id: string;
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
  created_at: string;
  last_used_at: string | null;
}

// ---------------------------------------------------------------------------
// Tier limits
// ---------------------------------------------------------------------------

export interface TierLimit {
  dailyLimit: number;
  ratePerMinute: number;
  maxBatchSize: number;
}

export const TIER_LIMITS: Record<ApiTier, TierLimit> = {
  free: { dailyLimit: 25, ratePerMinute: 60, maxBatchSize: 10 },
  pro: { dailyLimit: 100, ratePerMinute: 60, maxBatchSize: 100 },
  enterprise: { dailyLimit: 5000, ratePerMinute: 300, maxBatchSize: 500 },
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
