import { NextRequest, NextResponse } from "next/server";
import { EventName } from "@paddle/paddle-node-sdk";
import type { SubscriptionNotification } from "@paddle/paddle-node-sdk";
import { getPaddleClient } from "@/lib/paddle";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

export async function POST(req: NextRequest) {
  const paddle = getPaddleClient();
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;

  if (!paddle || !webhookSecret) {
    return NextResponse.json(
      { error: "Paddle not configured" },
      { status: 500 }
    );
  }

  const signature = req.headers.get("paddle-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 401 });
  }

  const rawBody = await req.text();

  let event;
  try {
    event = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature);
  } catch {
    logger.warn("Paddle webhook signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
        await upsertSubscription(event.data as SubscriptionNotification);
        break;

      case EventName.SubscriptionCanceled:
        await handleCanceled(event.data as SubscriptionNotification);
        break;

      case EventName.SubscriptionPastDue:
        await handlePastDue(event.data as SubscriptionNotification);
        break;

      case EventName.SubscriptionPaused:
        await handlePaused(event.data as SubscriptionNotification);
        break;

      default:
        logger.info(`Paddle webhook ignored: ${event.eventType}`);
    }
  } catch (err) {
    logger.error("Paddle webhook handler error", { error: err });
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKeyId(sub: SubscriptionNotification): number | null {
  const customData = sub.customData as Record<string, unknown> | null;
  const raw = customData?.apiKeyId;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function getUserId(sub: SubscriptionNotification): string | null {
  const customData = sub.customData as Record<string, unknown> | null;
  const raw = customData?.userId;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return null;
}

function getPlan(sub: SubscriptionNotification): string | null {
  const proPriceId = process.env.PADDLE_PRO_PRICE_ID;
  const enterprisePriceId = process.env.PADDLE_ENTERPRISE_PRICE_ID;
  const extensionProPriceId = process.env.PADDLE_EXTENSION_PRO_PRICE_ID;
  const mobilePremiumPriceId = process.env.PADDLE_MOBILE_PREMIUM_PRICE_ID;

  for (const item of sub.items) {
    if (item.price?.id === enterprisePriceId) return "enterprise";
    if (item.price?.id === proPriceId) return "pro";
    if (item.price?.id === extensionProPriceId) return "extension_pro";
    if (item.price?.id === mobilePremiumPriceId) return "mobile_premium";
  }
  return null;
}

async function verifyOwnership(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
  apiKeyId: number,
  userId: string | null
): Promise<boolean> {
  if (!userId) return true; // No userId in customData — legacy, allow

  const { data } = await supabase
    .from("api_keys")
    .select("user_id")
    .eq("id", apiKeyId)
    .single();

  if (!data) return false;

  // Allow if key has no user_id (legacy) or matches
  if (!data.user_id) return true;
  return data.user_id === userId;
}

async function upsertSubscription(sub: SubscriptionNotification) {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const apiKeyId = getApiKeyId(sub);
  if (!apiKeyId) {
    logger.warn("Paddle subscription missing apiKeyId in customData", {
      subscriptionId: sub.id,
    });
    return;
  }

  const userId = getUserId(sub);

  // Verify ownership — prevent subscription theft
  const owns = await verifyOwnership(supabase, apiKeyId, userId);
  if (!owns) {
    logger.warn("Paddle subscription ownership mismatch", {
      subscriptionId: sub.id,
      apiKeyId,
      userId,
    });
    return;
  }

  const plan = getPlan(sub);
  if (!plan) {
    logger.warn("Paddle subscription has unknown price ID", {
      subscriptionId: sub.id,
    });
    return;
  }

  const { error } = await supabase.from("subscriptions").upsert(
    {
      api_key_id: apiKeyId,
      user_id: userId,
      paddle_subscription_id: sub.id,
      paddle_customer_id: sub.customerId,
      paddle_price_id: sub.items[0]?.price?.id ?? "",
      plan,
      status: sub.status as string,
      current_period_start:
        sub.currentBillingPeriod?.startsAt ?? null,
      current_period_end:
        sub.currentBillingPeriod?.endsAt ?? null,
      cancel_at: sub.scheduledChange?.effectiveAt ?? null,
      canceled_at: sub.canceledAt ?? null,
      paused_at: sub.pausedAt ?? null,
      metadata: (sub.customData as Record<string, unknown>) ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "paddle_subscription_id" }
  );

  if (error) {
    logger.error("Failed to upsert subscription", { error });
    throw error;
  }

  await syncTier(supabase, apiKeyId, plan, sub.status as string);

  // Handle extension subscriptions — upsert into extension_subscriptions table
  if (plan === "extension_pro") {
    const customData = sub.customData as Record<string, unknown> | null;
    const installId = customData?.installId as string | undefined;
    if (installId) {
      await supabase.from("extension_subscriptions").upsert(
        {
          install_id: installId,
          paddle_subscription_id: sub.id,
          paddle_customer_id: sub.customerId,
          tier: "pro",
          status: sub.status as string,
          current_period_end: sub.currentBillingPeriod?.endsAt ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "install_id" }
      );
    }
  }
}

async function handleCanceled(sub: SubscriptionNotification) {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      canceled_at: sub.canceledAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", sub.id);

  if (error) {
    logger.error("Failed to update canceled subscription", { error });
    throw error;
  }

  const apiKeyId = getApiKeyId(sub);
  if (apiKeyId) {
    await syncTier(supabase, apiKeyId, "pro", "canceled");
  }
}

async function handlePastDue(sub: SubscriptionNotification) {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", sub.id);

  if (error) {
    logger.error("Failed to update past_due subscription", { error });
    throw error;
  }

  // Keep current tier — Paddle handles dunning retries
  logger.warn("Subscription past due, keeping current tier", {
    subscriptionId: sub.id,
  });
}

async function handlePaused(sub: SubscriptionNotification) {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("Supabase not configured");

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "paused",
      paused_at: sub.pausedAt ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("paddle_subscription_id", sub.id);

  if (error) {
    logger.error("Failed to update paused subscription", { error });
    throw error;
  }

  const apiKeyId = getApiKeyId(sub);
  if (apiKeyId) {
    await syncTier(supabase, apiKeyId, "pro", "paused");
  }
}

async function syncTier(
  supabase: NonNullable<ReturnType<typeof createServiceClient>>,
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
