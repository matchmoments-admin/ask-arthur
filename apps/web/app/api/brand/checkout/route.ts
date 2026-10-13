import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { brandMonitorPriceId } from "@/lib/brandSkus";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { hasPermission, type OrgRole } from "@askarthur/types";
import { canonicalBrandKey } from "@/lib/clone-watch/canonical-brand-key";
import { createPendingBrandSubscriber } from "@/lib/clone-watch/brand-subscriber";

// Brand Monitor checkout (Wave 3 of clone-watch-enforcement-and-monetisation;
// Brand activation 2/4). Session-authed, org-anchored: the purchaser must be
// an ACTIVE member of the target org holding billing:manage (owner/admin) —
// the server verifies against org_members and never trusts the client-supplied
// orgId alone. The Stripe webhook re-verifies the same relationship before
// provisioning (defence in depth), mirroring /api/extension/checkout.
//
// Gated on FF_BRAND_EXPOSURE (the Wave 2/3 brand-funnel flag, ON in prod since
// 2026-07-18): the route is reachable on deploy but returns
// price_not_configured until the founder creates the Stripe products and
// pastes the NEXT_PUBLIC_STRIPE_BRAND_MONITOR_* price IDs into Vercel.
//
// brand_pilot is intentionally not accepted here — it is provisioned manually
// (billing_provider='manual'), never via self-serve checkout. See brandSkus.ts.
// The self-serve tiers are not linked from the public pricing page (#1295
// decision 5: sell only the manual pilot until the first customer); the route
// stays so the flow is ready when pricing leaves the fog.
//
// #1295: checkout collects the brand FIRST. A `pending` Brand Subscriber row
// (monitored_brands, v347) is created before the Stripe session and its id
// rides in the server-set metadata, so the webhook activates exactly that row.
// A payment that cannot be attached lands in brand_unmatched_payments.

/** Lower-case host: strips scheme, www., path and a trailing dot. */
function normaliseDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const CheckoutSchema = z.object({
  orgId: z.string().uuid(),
  plan: z.enum(["brand_monitor", "brand_monitor_plus"]),
  brandName: z.string().trim().min(2).max(120),
  primaryDomain: z
    .string()
    .max(253)
    .transform(normaliseDomain)
    .refine((d) => DOMAIN.test(d), "primaryDomain must be a domain, e.g. example.com.au"),
  /** Who receives this brand's alerts and monthly report. Defaults to the
   *  purchaser's own email. */
  alertContactEmail: z.string().trim().toLowerCase().email().max(254).optional(),
});

export async function POST(req: NextRequest) {
  try {
    if (!featureFlags.brandExposure) {
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
    const { orgId, plan, brandName, primaryDomain, alertContactEmail } = parsed.data;

    const priceId = brandMonitorPriceId(plan);
    if (!priceId) {
      logger.error("Brand Monitor price env missing", { plan });
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
            "You need to be an owner or admin of this organisation to purchase Brand Monitor.",
        },
        { status: 403 },
      );
    }

    // The ADR-0020 Canonical Brand: alias-resolve the typed name, then
    // brand_normalize — so "AusPost" and "Australia Post" are one subscriber,
    // and the key matches clone alerts' target_brand_normalized. An alias
    // read failure only weakens canonicalisation (falls back to the raw name).
    const brandNormalized = await canonicalBrandKey(supabase, brandName);
    if (!brandNormalized) {
      return NextResponse.json(
        { error: "validation_error", message: "brandName has no letters or digits" },
        { status: 400 },
      );
    }

    const pending = await createPendingBrandSubscriber(supabase, {
      orgId,
      brandName,
      brandNormalized,
      primaryDomain,
      plan,
      alertContactEmail: alertContactEmail ?? user.email ?? null,
      createdBy: user.id,
    });
    if (pending.outcome === "already_subscribed") {
      return NextResponse.json(
        {
          error: "already_subscribed",
          message: "This brand already has an active subscription in this organisation.",
        },
        { status: 409 },
      );
    }

    const customerId = await getOrCreateStripeCustomer(user.id, user.email, supabase);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";
    const meta = {
      org_id: orgId,
      user_id: user.id,
      plan,
      brand_subscriber_id: String(pending.brandSubscriberId),
    };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: meta },
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      metadata: meta,
      success_url: `${siteUrl}/brand-exposure?billing=success`,
      cancel_url: `${siteUrl}/brand-exposure?billing=canceled`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error("Brand checkout error", { error: String(err) });
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
