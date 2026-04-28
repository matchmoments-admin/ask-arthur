import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

// Next.js page-data collection imports this module at build time. The Stripe
// SDK rejects empty-string keys with "Neither apiKey nor config.authenticator
// provided", so env-less CI builds break unless we provide a placeholder.
// `||` (not `??`) because we want to coalesce on falsy *including empty
// string*. The real key wins in any environment that configures it; the
// placeholder is only ever exercised at build time when no Stripe call fires.
export const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY || "sk_test_buildtime_placeholder"
);

export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  supabase: SupabaseClient
): Promise<string> {
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .single();

  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const customer = await stripe.customers.create({
    email,
    metadata: { supabase_user_id: userId },
  });

  await supabase
    .from("user_profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);

  return customer.id;
}
