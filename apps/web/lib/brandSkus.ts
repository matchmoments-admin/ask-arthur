import "server-only";

import type { BrandPlanKey } from "@askarthur/types/billing";

// Brand Monitor SKU registry — mirrors extensionSkus.ts: price IDs come from
// NEXT_PUBLIC_STRIPE_BRAND_MONITOR_* env vars pasted from the Stripe Dashboard
// (AUD, GST-inclusive, automatic_tax on). Prices are fixed by BRAND_PLANS in
// @askarthur/types/billing (Wave 3 of clone-watch-enforcement-and-monetisation):
//
//   brand_monitor       A$1,950/mo — 1 brand,   5 managed takedowns/mo
//   brand_monitor_plus  A$2,950/mo — ≤3 brands, 15 managed takedowns/mo
//
// Deliberately ABSENT from this registry:
//   - brand_pilot (A$300/mo, police/government/non-profit): provisioned
//     MANUALLY (billing_provider='manual') by the founder for design-partner
//     pilots — it never gets a Stripe product or a self-serve checkout path
//     (see Brand activation 3/4 + migration v204's header comment).
//   - brand_enterprise: custom-priced, contact-sales only.
//
// The webhook uses isBrandMonitorPrice() to dispatch a subscription into the
// org-keyed brand-billing path instead of the api_keys B2B path — brand plans
// are a separate SKU axis from TIER_LIMITS and must NEVER touch api_keys.tier.

/** The two self-serve Stripe-checkout brand plans (subset of BrandPlanKey). */
export type BrandCheckoutPlan = Extract<
  BrandPlanKey,
  "brand_monitor" | "brand_monitor_plus"
>;

export function brandMonitorPriceId(plan: BrandCheckoutPlan): string | null {
  const id =
    plan === "brand_monitor"
      ? process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_MONTHLY
      : process.env.NEXT_PUBLIC_STRIPE_BRAND_MONITOR_PLUS_MONTHLY;
  return id && id.length > 0 ? id : null;
}

export function isBrandMonitorPrice(priceId: string): boolean {
  if (!priceId) return false;
  return (
    priceId === brandMonitorPriceId("brand_monitor") ||
    priceId === brandMonitorPriceId("brand_monitor_plus")
  );
}

/** Resolve a Stripe price ID back to its subscriptions.plan value. */
export function brandPlanForPrice(priceId: string): BrandCheckoutPlan | null {
  if (!priceId) return null;
  if (priceId === brandMonitorPriceId("brand_monitor")) return "brand_monitor";
  if (priceId === brandMonitorPriceId("brand_monitor_plus")) {
    return "brand_monitor_plus";
  }
  return null;
}

/** Map a Stripe subscription status onto the brand-billing record's status
 *  (active | past_due | canceled | paused). Monitoring entitlement follows
 *  monitored_brands.plan, which we only SET on 'active' and only CLEAR on
 *  cancellation — past_due keeps monitoring alive through Stripe's dunning
 *  window (B2B grace) while the ledger records the arrears. */
export function mapStripeStatusToBrandBillingStatus(
  stripeStatus: string,
): "active" | "past_due" | "canceled" | "paused" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "paused":
      return "paused";
    default:
      // canceled, incomplete_expired, anything new Stripe adds.
      return "canceled";
  }
}
