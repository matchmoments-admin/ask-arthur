import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { documentPlanPriceId } from "@/lib/documentSkus";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { readStringEnv } from "@askarthur/utils/env";
import { hasPermission, type OrgRole } from "@askarthur/types";

// Document Check plan checkout (Stage 3, item 3 — the rental-vertical
// self-serve rail). Copies the Brand Monitor checkout shape verbatim:
// session-authed, org-anchored — the purchaser must be an ACTIVE member of
// the target org holding billing:manage (owner/admin); the server verifies
// against org_members and never trusts the client-supplied orgId. The
// Stripe webhook re-verifies the same relationship before provisioning.
//
// Gated on FF_DOCUMENT_CHECK_BILLING: reachable on deploy but returns
// price_not_configured until the founder creates the Stripe products and
// pastes the NEXT_PUBLIC_STRIPE_DOC_CHECK_* price IDs into Vercel (runbook:
// docs/ops/document-check-billing-config.md). The optional
// STRIPE_DOC_CHECK_PILOT_COUPON applies the first-month-free pilot offer.
//
// The first pilot is provisioned MANUALLY (billing_provider='manual', the
// brand_pilot precedent) — this route is the later self-serve path.

const CheckoutSchema = z.object({
  orgId: z.string().uuid(),
  plan: z.enum(["doc_starter", "doc_pro"]),
});

export async function POST(req: NextRequest) {
  try {
    if (!featureFlags.documentCheckBilling) {
      return NextResponse.json({ error: "feature_disabled" }, { status: 503 });
    }

    let user;
    try {
      user = await getUser();
    } catch (err) {
      if (err instanceof AuthUnavailableError) {
        return NextResponse.json(
          { error: "auth_unavailable" },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      throw err;
    }
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const parsed = CheckoutSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }
    const { orgId, plan } = parsed.data;

    const priceId = documentPlanPriceId(plan);
    if (!priceId) {
      logger.error("Document Check price env missing", { plan });
      return NextResponse.json({ error: "price_not_configured" }, { status: 503 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }

    const { data: membership } = await supabase
      .from("org_members")
      .select("role, status")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (
      !membership ||
      !hasPermission(membership.role as OrgRole, "billing:manage")
    ) {
      return NextResponse.json(
        {
          error: "not_org_billing_admin",
          message:
            "You need to be an owner or admin of this organisation to purchase Document Check.",
        },
        { status: 403 },
      );
    }

    // One live subscription lineage per org: storage is a single org-keyed
    // record and the deletion branch refuses non-matching sub ids, so a
    // second checkout (double-submit, second admin, or an upgrade attempt)
    // would strand an invisible-but-billing subscription. Upgrades go
    // through the Stripe portal / support until a portal flow ships.
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    const existingBilling = (orgRow?.settings as Record<string, unknown> | null)
      ?.document_billing as { status?: string } | undefined;
    if (
      existingBilling?.status === "active" ||
      existingBilling?.status === "past_due"
    ) {
      return NextResponse.json(
        {
          error: "already_subscribed",
          message:
            "This organisation already has an active Document Check plan. To change plans, use the billing portal or contact us.",
        },
        { status: 409 },
      );
    }

    const customerId = await getOrCreateStripeCustomer(user.id, user.email, supabase);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";
    const meta = { org_id: orgId, user_id: user.id, plan };
    // readStringEnv: trims + bracket access (a trailing newline in the
    // pasted coupon id, or a var added after deploy, must not 500 every
    // pilot checkout or silently drop the discount).
    const pilotCoupon = readStringEnv("STRIPE_DOC_CHECK_PILOT_COUPON");

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: meta },
      automatic_tax: { enabled: true },
      // The pilot coupon and user-entered promotion codes are mutually
      // exclusive in Stripe's API — apply the pilot discount when
      // configured, otherwise leave the promo-code box available.
      ...(pilotCoupon && pilotCoupon.length > 0
        ? { discounts: [{ coupon: pilotCoupon }] }
        : { allow_promotion_codes: true }),
      metadata: meta,
      // Land on the authed dashboard, NOT /document-check: that page is
      // gated by a DIFFERENT flag (NEXT_PUBLIC_FF_DOCUMENT_CHECK) and a
      // paying customer must never 404 after checkout if the operator
      // flipped only the billing flag.
      success_url: `${siteUrl}/app?billing=doc_success`,
      cancel_url: `${siteUrl}/app?billing=doc_canceled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error("Document Check checkout error", { error: String(err) });
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
