import { z } from "zod";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const SubscriptionPlanSchema = z.enum(["pro", "enterprise"]);
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
