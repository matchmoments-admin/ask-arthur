import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@askarthur/supabase/server";

export async function POST() {
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

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return NextResponse.json(
      { error: "No billing account found" },
      { status: 404 }
    );
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://askarthur.au";

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${siteUrl}/app/billing`,
  });

  return NextResponse.json({ url: session.url });
}
