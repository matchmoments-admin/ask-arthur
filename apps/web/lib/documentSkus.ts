import "server-only";

// Document Check SKU registry — mirrors brandSkus.ts: price IDs come from
// NEXT_PUBLIC_STRIPE_DOC_CHECK_* env vars pasted from the Stripe Dashboard
// (AUD, GST-inclusive, automatic_tax on). Pricing locked 2026-08-21 from
// competitor research (VerifyPDF US$15/79, TamperCheck US$0.50/doc):
//
//   doc_starter  A$29/mo  —   200 document checks / calendar month
//   doc_pro      A$99/mo  — 1,500 document checks / calendar month
//
// Like brand plans, doc plans are a SEPARATE SKU AXIS from TIER_LIMITS and
// must NEVER touch api_keys.tier (selling doc_pro as tier `business` would
// hand A$449-tier API volume for A$99, and the tier is key-scoped while the
// document meter is org-scoped). The webhook uses isDocumentPlanPrice() to
// dispatch into the org-keyed document-billing path
// (organizations.settings.document_billing) before the api_keys path.
//
// The first rental pilot is provisioned MANUALLY (billing_provider='manual',
// the brand_pilot precedent) — no Stripe product needed; see
// docs/ops/document-check-billing-config.md.

export type DocumentPlanKey = "doc_starter" | "doc_pro";

export const DOCUMENT_PLANS: Record<
  DocumentPlanKey,
  { monthlyPriceAud: number; documentChecksPerMonth: number }
> = {
  doc_starter: { monthlyPriceAud: 29, documentChecksPerMonth: 200 },
  doc_pro: { monthlyPriceAud: 99, documentChecksPerMonth: 1500 },
};

export function documentPlanPriceId(plan: DocumentPlanKey): string | null {
  const id =
    plan === "doc_starter"
      ? process.env.NEXT_PUBLIC_STRIPE_DOC_CHECK_STARTER_MONTHLY
      : process.env.NEXT_PUBLIC_STRIPE_DOC_CHECK_PRO_MONTHLY;
  return id && id.length > 0 ? id : null;
}

export function isDocumentPlanPrice(priceId: string): boolean {
  if (!priceId) return false;
  return (
    priceId === documentPlanPriceId("doc_starter") ||
    priceId === documentPlanPriceId("doc_pro")
  );
}

/** Resolve a Stripe price ID back to its document plan. */
export function documentPlanForPrice(priceId: string): DocumentPlanKey | null {
  if (!priceId) return null;
  if (priceId === documentPlanPriceId("doc_starter")) return "doc_starter";
  if (priceId === documentPlanPriceId("doc_pro")) return "doc_pro";
  return null;
}

/** Map a Stripe subscription status onto the document-billing record's
 *  status. NARROWER than the brand mapping on purpose (PR #1033 review):
 *  the allowance IS the entitlement here (no second active-only gate like
 *  monitored_brands.plan), so only true dunning (`past_due`) keeps it
 *  alive. `incomplete` (first payment never succeeded) and `unpaid`
 *  (terminal dunning failure that never emits subscription.deleted) must
 *  NOT grant 200/1,500 checks — they map to non-entitled states. */
export function mapStripeStatusToDocumentBillingStatus(
  stripeStatus: string,
): "active" | "past_due" | "canceled" | "paused" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "paused":
    case "incomplete":
      return "paused";
    default:
      // canceled, unpaid, incomplete_expired, anything new Stripe adds.
      return "canceled";
  }
}
