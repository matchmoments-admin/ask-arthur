import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import {
  resolvePhoneFootprintEntitlement,
  isPhoneFootprintPrice,
} from "@/lib/phoneFootprintSkus";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook secret not configured" },
      { status: 500 }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch {
    logger.warn("Stripe webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 500 }
    );
  }

  // Idempotency gate: claim event.id via insert-with-conflict. If another
  // delivery of the same event already landed, skip the switch below and
  // return 200 so Stripe doesn't retry forever.
  const { data: claimed, error: claimErr } = await supabase
    .from("stripe_event_log")
    .insert({
      event_id: event.id,
      event_type: event.type,
      api_version: event.api_version ?? null,
    })
    .select("event_id")
    .maybeSingle();

  if (claimErr && claimErr.code !== "23505") {
    // 23505 is the duplicate-key error code we intentionally swallow below;
    // any other error means the log table itself is broken — surface it so
    // Stripe retries rather than letting the event silently drop.
    logger.error("Stripe idempotency claim failed", { error: claimErr });
    return NextResponse.json({ error: "idempotency_claim_failed" }, { status: 500 });
  }
  if (!claimed) {
    logger.info("Stripe webhook duplicate event — skipping", { eventId: event.id });
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as unknown as Record<string, unknown>, supabase);
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscription(event.data.object as unknown as Record<string, unknown>, supabase);
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as unknown as Record<string, unknown>, supabase);
        break;

      case "invoice.paid":
        await handleInvoicePaid(event.data.object as unknown as Record<string, unknown>, supabase);
        break;

      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event.data.object as unknown as Record<string, unknown>, supabase);
        break;

      default:
        logger.info(`Stripe webhook ignored: ${event.type}`);
    }
  } catch (err) {
    logger.error("Stripe webhook handler error", { error: err });
    // Roll the idempotency claim back so Stripe's retry can try again; a
    // stuck row in stripe_event_log would otherwise block reprocessing after
    // we fix whatever downstream failure caused the throw.
    await supabase.from("stripe_event_log").delete().eq("event_id", event.id);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }

  await supabase
    .from("stripe_event_log")
    .update({ processed_at: new Date().toISOString() })
    .eq("event_id", event.id);

  return NextResponse.json({ received: true });
}

type SupabaseService = NonNullable<ReturnType<typeof createServiceClient>>;

function getPlan(priceId: string): string {
  const businessMonthly = process.env.NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY;
  const businessAnnual = process.env.NEXT_PUBLIC_STRIPE_BUSINESS_ANNUAL;

  if (priceId === businessMonthly || priceId === businessAnnual) {
    return "business";
  }
  return "pro";
}

async function handleCheckoutCompleted(
  session: Record<string, unknown>,
  supabase: SupabaseService
) {
  const subscriptionId = session.subscription as string | undefined;
  if (!subscriptionId) return;

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertSubscription(subscription as unknown as Record<string, unknown>, supabase);
}

async function upsertSubscription(
  sub: Record<string, unknown>,
  supabase: SupabaseService
) {
  const metadata = sub.metadata as Record<string, string> | undefined;
  const items = sub.items as { data: Array<{ price: { id: string } }> };
  const priceId = items?.data?.[0]?.price?.id ?? "";

  // Phone Footprint branch: separate entitlements table, separate RPC.
  // Dispatches BEFORE the api_keys.tier path so a PF-only subscription
  // without api_key_id metadata doesn't get rejected. The two paths are
  // orthogonal and a customer could in principle hold both (Business API
  // + Personal PF), so we don't early-return — but today in practice a
  // given subscription is one or the other.
  if (isPhoneFootprintPrice(priceId)) {
    await upsertPhoneFootprintSubscription(sub, supabase, priceId);
    return;
  }

  const apiKeyId = metadata?.api_key_id
    ? parseInt(metadata.api_key_id, 10)
    : null;
  const userId = metadata?.user_id as string | undefined;

  if (!apiKeyId || Number.isNaN(apiKeyId)) {
    logger.warn("Stripe subscription missing api_key_id in metadata", {
      subscriptionId: sub.id,
    });
    return;
  }

  const plan = getPlan(priceId);
  const status = sub.status as string;
  const currentPeriodStart = sub.current_period_start as number | undefined;
  const currentPeriodEnd = sub.current_period_end as number | undefined;
  const cancelAt = sub.cancel_at as number | null;
  const canceledAt = sub.canceled_at as number | null;

  const { error } = await supabase.from("subscriptions").upsert(
    {
      api_key_id: apiKeyId,
      user_id: userId ?? null,
      stripe_subscription_id: sub.id as string,
      stripe_customer_id: sub.customer as string,
      stripe_price_id: priceId,
      plan,
      status,
      current_period_start: currentPeriodStart
        ? new Date(currentPeriodStart * 1000).toISOString()
        : null,
      current_period_end: currentPeriodEnd
        ? new Date(currentPeriodEnd * 1000).toISOString()
        : null,
      cancel_at: cancelAt
        ? new Date(cancelAt * 1000).toISOString()
        : null,
      canceled_at: canceledAt
        ? new Date(canceledAt * 1000).toISOString()
        : null,
      metadata: metadata ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" }
  );

  if (error) {
    logger.error("Failed to upsert Stripe subscription", { error });
    throw error;
  }

  await syncTier(supabase, apiKeyId, plan, status);
}

// ---------------------------------------------------------------------------
// Phone Footprint — parallel entitlement path
// ---------------------------------------------------------------------------
// Does NOT touch api_keys.tier or sync_subscription_tier. Writes to the
// dedicated phone_footprint_entitlements table via the
// sync_phone_footprint_entitlements RPC shipped in migration v75.
//
// Metadata expected on Stripe subscription:
//   - user_id: UUID (for consumer SKUs)
//   - org_id:  UUID (for fleet SKUs) — required by the table's
//              pfe_single_owner check constraint
// If neither is present we log-and-skip (rather than throwing into the
// webhook retry loop) — manual reconciliation via the admin console is
// preferable to a stuck Stripe event.
async function upsertPhoneFootprintSubscription(
  sub: Record<string, unknown>,
  supabase: SupabaseService,
  priceId: string,
) {
  const entitlement = resolvePhoneFootprintEntitlement(priceId);
  if (!entitlement) return; // Defensive — caller already gated

  const metadata = sub.metadata as Record<string, string> | undefined;
  const userId = entitlement.isFleet ? null : (metadata?.user_id ?? null);
  const orgId = entitlement.isFleet ? (metadata?.org_id ?? null) : null;

  if (!userId && !orgId) {
    logger.warn(
      "Phone Footprint subscription missing user_id/org_id metadata — manual reconciliation required",
      {
        subscriptionId: sub.id,
        sku: entitlement.sku,
        fleet: entitlement.isFleet,
      },
    );
    return;
  }

  const status = sub.status as string;
  const currentPeriodEnd = sub.current_period_end as number | undefined;

  const { error } = await supabase.rpc("sync_phone_footprint_entitlements", {
    p_user_id: userId,
    p_org_id: orgId,
    p_stripe_subscription_id: sub.id as string,
    p_stripe_price_id: priceId,
    p_sku: entitlement.sku,
    p_status: status,
    p_current_period_end: currentPeriodEnd
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null,
    p_saved_numbers_limit: entitlement.saved_numbers_limit,
    p_monthly_lookup_limit: entitlement.monthly_lookup_limit,
    p_refresh_cadence_min: entitlement.refresh_cadence_min,
    p_features: entitlement.features,
  });

  if (error) {
    logger.error("Failed to sync phone-footprint entitlement", {
      error,
      subscriptionId: sub.id,
      sku: entitlement.sku,
    });
    throw error;
  }

  logger.info("Phone Footprint entitlement synced", {
    subscriptionId: sub.id,
    sku: entitlement.sku,
    status,
    scope: entitlement.isFleet ? "org" : "user",
  });
}

async function handleSubscriptionDeleted(
  sub: Record<string, unknown>,
  supabase: SupabaseService
) {
  const items = sub.items as { data: Array<{ price: { id: string } }> };
  const priceId = items?.data?.[0]?.price?.id ?? "";

  // Phone Footprint branch: flip entitlement to canceled. Don't mutate
  // the B2B subscriptions table since this row was never written there.
  if (isPhoneFootprintPrice(priceId)) {
    const entitlement = resolvePhoneFootprintEntitlement(priceId);
    if (!entitlement) return;

    const { error } = await supabase
      .from("phone_footprint_entitlements")
      .update({
        status: "canceled",
        updated_at: new Date().toISOString(),
      })
      .eq("stripe_subscription_id", sub.id as string);

    if (error) {
      logger.error("Failed to cancel phone-footprint entitlement", {
        error,
        subscriptionId: sub.id,
      });
      throw error;
    }
    logger.info("Phone Footprint entitlement canceled", {
      subscriptionId: sub.id,
      sku: entitlement.sku,
    });
    return;
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", sub.id as string);

  if (error) {
    logger.error("Failed to update canceled Stripe subscription", { error });
    throw error;
  }

  const metadata = sub.metadata as Record<string, string> | undefined;
  const apiKeyId = metadata?.api_key_id
    ? parseInt(metadata.api_key_id, 10)
    : null;

  if (apiKeyId && !Number.isNaN(apiKeyId)) {
    await syncTier(supabase, apiKeyId, "free", "canceled");
  }
}

async function handleInvoicePaid(
  invoice: Record<string, unknown>,
  supabase: SupabaseService
) {
  const subscriptionId = invoice.subscription as string | undefined;
  if (!subscriptionId) return;

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    logger.error("Failed to update subscription after invoice.paid", { error });
    throw error;
  }
}

async function handleInvoicePaymentFailed(
  invoice: Record<string, unknown>,
  supabase: SupabaseService
) {
  const subscriptionId = invoice.subscription as string | undefined;
  if (!subscriptionId) return;

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    logger.error("Failed to update subscription after payment failure", {
      error,
    });
    throw error;
  }
}

async function syncTier(
  supabase: SupabaseService,
  apiKeyId: number,
  plan: string,
  status: string
) {
  const { error } = await supabase.rpc("sync_subscription_tier", {
    p_api_key_id: apiKeyId,
    p_plan: plan,
    p_status: status,
  });

  if (error) {
    logger.error("Failed to sync subscription tier", { error });
    throw error;
  }
}
