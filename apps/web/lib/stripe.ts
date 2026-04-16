import "server-only";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

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
