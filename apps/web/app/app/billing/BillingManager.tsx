"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { initializePaddle } from "@paddle/paddle-js";
import type { Paddle } from "@paddle/paddle-js";
import { TIER_LIMITS } from "@askarthur/types/billing";

const proPriceId = process.env.NEXT_PUBLIC_PADDLE_PRO_PRICE_ID ?? "";
const enterprisePriceId =
  process.env.NEXT_PUBLIC_PADDLE_ENTERPRISE_PRICE_ID ?? "";

interface ApiKey {
  id: number;
  org_name: string;
  tier: string;
}

interface SubscriptionRecord {
  id: number;
  api_key_id: number;
  plan: string;
  status: string;
  paddle_subscription_id: string;
  current_period_end: string | null;
}

export default function BillingManager({
  userId,
  userEmail,
  keys,
  subscriptions,
}: {
  userId: string;
  userEmail: string;
  keys: ApiKey[];
  subscriptions: SubscriptionRecord[];
}) {
  const [paddle, setPaddle] = useState<Paddle>();

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) return;

    const env =
      (process.env.NEXT_PUBLIC_PADDLE_ENV as "sandbox" | "production") ??
      "sandbox";

    initializePaddle({ token, environment: env }).then((instance) => {
      if (instance) setPaddle(instance);
    });
  }, []);

  function openCheckout(priceId: string, apiKeyId: number) {
    if (!paddle) return;
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email: userEmail },
      customData: { apiKeyId: String(apiKeyId), userId },
    });
  }

  function getSubscriptionForKey(
    keyId: number
  ): SubscriptionRecord | undefined {
    return subscriptions.find(
      (s) => s.api_key_id === keyId && ["active", "trialing"].includes(s.status)
    );
  }

  if (keys.length === 0) {
    return (
      <div className="rounded-xl border border-border-light bg-slate-50 p-6 text-center">
        <p className="text-gov-slate text-sm mb-3">
          Create an API key first to subscribe to a paid plan.
        </p>
        <Link
          href="/app/keys"
          className="inline-block rounded-lg bg-action-teal text-white font-bold text-sm px-5 py-2.5 hover:bg-action-teal/90 transition-colors"
        >
          Create API Key
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {keys.map((key) => {
        const sub = getSubscriptionForKey(key.id);
        const tierLimits =
          TIER_LIMITS[key.tier as keyof typeof TIER_LIMITS] ?? TIER_LIMITS.free;

        return (
          <div
            key={key.id}
            className="rounded-xl border border-border-light bg-white p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-deep-navy font-extrabold text-sm">
                  {key.org_name}
                </h3>
                <p className="text-gov-slate text-xs">
                  {tierLimits.dailyLimit} req/day · {tierLimits.ratePerMinute}{" "}
                  RPM
                </p>
              </div>
              <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-teal-50 text-action-teal">
                {key.tier}
              </span>
            </div>

            {sub ? (
              <div className="text-sm text-gov-slate">
                <p>
                  Active <strong className="capitalize">{sub.plan}</strong>{" "}
                  subscription
                  {sub.current_period_end && (
                    <>
                      {" "}
                      · Renews{" "}
                      {new Date(sub.current_period_end).toLocaleDateString()}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="flex gap-2">
                {key.tier !== "pro" && key.tier !== "enterprise" && (
                  <button
                    onClick={() => openCheckout(proPriceId, key.id)}
                    disabled={!paddle}
                    className="rounded-lg bg-action-teal text-white font-bold text-xs px-4 py-2 hover:bg-action-teal/90 transition-colors disabled:opacity-50"
                  >
                    Upgrade to Pro ($49/mo)
                  </button>
                )}
                {key.tier !== "enterprise" && (
                  <button
                    onClick={() => openCheckout(enterprisePriceId, key.id)}
                    disabled={!paddle}
                    className="rounded-lg bg-deep-navy text-white font-bold text-xs px-4 py-2 hover:bg-deep-navy/90 transition-colors disabled:opacity-50"
                  >
                    Upgrade to Enterprise ($249/mo)
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
