import "server-only";

// Extension Pro SKU registry — mirrors phoneFootprintSkus.ts: price IDs come
// from NEXT_PUBLIC_STRIPE_EXTENSION_PRO_* env vars pasted from the Stripe
// Dashboard (A$4.99/mo, A$49/yr). The webhook uses isExtensionProPrice() to
// dispatch a subscription into the extension_subscriptions path instead of
// the api_keys B2B path.

export type ExtensionProInterval = "monthly" | "annual";

export function extensionProPriceId(interval: ExtensionProInterval): string | null {
  const id =
    interval === "monthly"
      ? process.env.NEXT_PUBLIC_STRIPE_EXTENSION_PRO_MONTHLY
      : process.env.NEXT_PUBLIC_STRIPE_EXTENSION_PRO_ANNUAL;
  return id && id.length > 0 ? id : null;
}

export function isExtensionProPrice(priceId: string): boolean {
  if (!priceId) return false;
  return (
    priceId === extensionProPriceId("monthly") ||
    priceId === extensionProPriceId("annual")
  );
}

/** Map a Stripe subscription status onto the extension_subscriptions status
 *  CHECK (active | past_due | canceled | paused). get_extension_tier only
 *  grants pro on status='active', so anything ambiguous degrades safely. */
export function mapStripeStatusToExtensionStatus(
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
