import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { stripe, getOrCreateStripeCustomer } from "@/lib/stripe";
import { createServiceClient } from "@askarthur/supabase/server";

export async function POST(req: NextRequest) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 500 }
    );
  }

  const { priceId, apiKeyId } = (await req.json()) as {
    priceId: string;
    apiKeyId: string;
  };

  if (!priceId || !apiKeyId) {
    return NextResponse.json(
      { error: "Missing priceId or apiKeyId" },
      { status: 400 }
    );
  }

  const customerId = await getOrCreateStripeCustomer(
    user.id,
    user.email,
    supabase
  );

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { api_key_id: apiKeyId, user_id: user.id },
    },
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
    metadata: { api_key_id: apiKeyId, user_id: user.id },
    success_url: `${siteUrl}/app/billing?success=1`,
    cancel_url: `${siteUrl}/app/billing`,
  });

  return NextResponse.json({ url: session.url });
}
