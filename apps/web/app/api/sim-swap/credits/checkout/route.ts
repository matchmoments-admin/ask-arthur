// POST /api/sim-swap/credits/checkout
//
// Creates a Stripe Checkout session for a one-time SIM-swap credit pack
// or recovery check purchase. Differs from the existing
// /api/stripe/checkout route in two ways:
//   1. mode='payment' (one-time) not 'subscription'.
//   2. Metadata carries `feature='sim_swap'` + `user_id` so the webhook
//      handler can route the completion to the credit-grant path.
//
// Returns: { url: <stripe checkout url> }
//
// Errors:
//   - 401 unauthenticated  (must be signed in to grant credits)
//   - 400 invalid_pack     (unknown pack name)
//   - 503 not_configured   (Stripe price env var missing)

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { createServiceClient } from "@askarthur/supabase/server";
import { getUser, AuthUnavailableError } from "@/lib/auth";
import { hasRedeemedSimSwapInvite } from "@/lib/simSwapBeta";
import { getSimSwapSkuMeta, type SimSwapSku } from "@/lib/simSwapSkus";

export const runtime = "nodejs";

const RequestBody = z.object({
  pack: z.enum(["sim_swap_credits_5pack", "sim_swap_recovery_check"]),
});

function priceIdForSku(sku: SimSwapSku): string | null {
  if (sku === "sim_swap_credits_5pack") {
    return process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK ?? null;
  }
  return process.env.STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK ?? null;
}

export async function POST(req: NextRequest) {
  // Flag gate — must mirror the check endpoint. Without this, a curious
  // user could buy credits before the feature is live (and we'd be
  // sitting on un-redeemable balances).
  if (!featureFlags.simSwapOnDemand) {
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
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Private-beta invite gate — must hold a redeemed invite to buy credits.
  if (!(await hasRedeemedSimSwapInvite(user.id))) {
    return NextResponse.json(
      { error: "invite_required" },
      { status: 403 },
    );
  }

  let body: z.infer<typeof RequestBody>;
  try {
    body = RequestBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "invalid_pack",
        detail: err instanceof z.ZodError ? err.flatten() : undefined,
      },
      { status: 400 },
    );
  }

  const meta = getSimSwapSkuMeta(body.pack);
  const priceId = priceIdForSku(body.pack);
  if (!priceId) {
    return NextResponse.json(
      { error: "not_configured", detail: `${body.pack}_price_missing` },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const customerId = await getOrCreateStripeCustomer(
    user.id,
    user.email,
    supabase,
  );

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
    payment_intent_data: {
      metadata: {
        feature: "sim_swap",
        sku: meta.sku,
        user_id: user.id,
      },
    },
    metadata: {
      feature: "sim_swap",
      sku: meta.sku,
      user_id: user.id,
    },
    success_url: `${siteUrl}/sim-swap-check?credits=ok`,
    cancel_url: `${siteUrl}/sim-swap-check?credits=cancelled`,
  });

  return NextResponse.json({ url: session.url, sku: meta.sku });
}
