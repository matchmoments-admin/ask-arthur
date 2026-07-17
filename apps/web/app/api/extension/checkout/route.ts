import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { extensionProPriceId } from "@/lib/extensionSkus";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";

// Extension Pro checkout. Session-authed (called from /extension/link, not
// from the extension itself). The install must already be LINKED to the
// logged-in user — the server verifies against extension_subscriptions and
// never trusts the client-supplied installId alone. The webhook re-verifies
// the same relationship before provisioning (defence in depth).

const CheckoutSchema = z.object({
  installId: z.string().min(8).max(128),
  interval: z.enum(["monthly", "annual"]),
});

export async function POST(req: NextRequest) {
  try {
    if (!featureFlags.extensionBilling) {
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
    const { installId, interval } = parsed.data;

    const priceId = extensionProPriceId(interval);
    if (!priceId) {
      logger.error("Extension Pro price env missing", { interval });
      return NextResponse.json({ error: "price_not_configured" }, { status: 503 });
    }

    const supabase = createServiceClient();
    if (!supabase) {
      return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
    }

    const { data: linked } = await supabase
      .from("extension_subscriptions")
      .select("user_id, tier")
      .eq("install_id", installId)
      .maybeSingle();
    if (!linked?.user_id || linked.user_id !== user.id) {
      return NextResponse.json(
        {
          error: "install_not_linked",
          message: "Link this extension to your account first (More → Link account).",
        },
        { status: 403 },
      );
    }

    const customerId = await getOrCreateStripeCustomer(user.id, user.email, supabase);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";
    const meta = { install_id: installId, user_id: user.id, plan: "extension_pro" };

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: meta },
      automatic_tax: { enabled: true },
      allow_promotion_codes: true,
      metadata: meta,
      success_url: `${siteUrl}/extension/link?success=1`,
      cancel_url: `${siteUrl}/extension/link?canceled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error("Extension checkout error", { error: String(err) });
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
