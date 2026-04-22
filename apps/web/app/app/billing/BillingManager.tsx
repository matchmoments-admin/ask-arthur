"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TIER_LIMITS } from "@askarthur/types/billing";

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
  stripe_subscription_id: string | null;
  current_period_end: string | null;
}

const proPriceMonthly = process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY ?? "";
const businessPriceMonthly = process.env.NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY ?? "";

export default function BillingManager({
  userId: _userId,
  userEmail: _userEmail,
  keys,
  subscriptions,
}: {
  userId: string;
  userEmail: string;
  keys: ApiKey[];
  subscriptions: SubscriptionRecord[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState<number | null>(null);

  async function openCheckout(priceId: string, apiKeyId: number) {
    setLoading(apiKeyId);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, apiKeyId }),
      });
      const data = await res.json();
      if (data.url) router.push(data.url);
    } catch {
      alert("Failed to open checkout. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  async function openPortal() {
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (data.url) router.push(data.url);
    } catch {
      alert("Failed to open billing portal.");
    }
  }

  function getSubForKey(keyId: number): SubscriptionRecord | undefined {
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
          className="inline-block rounded-lg bg-action-teal text-white font-bold text-sm px-5 py-2.5"
        >
          Create API Key
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {keys.map((key) => {
        const sub = getSubForKey(key.id);
        const tierKey = key.tier as keyof typeof TIER_LIMITS;
        const limits = TIER_LIMITS[tierKey] ?? TIER_LIMITS.free;
        const isLoading = loading === key.id;

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
                  {limits.requestsPerDay} req/day &middot;{" "}
                  {limits.requestsPerMinute} RPM
                </p>
              </div>
              <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full bg-teal-50 text-action-teal">
                {key.tier}
              </span>
            </div>

            {sub ? (
              <div className="space-y-2">
                <p className="text-sm text-gov-slate">
                  <strong className="capitalize">{sub.plan}</strong> plan &mdash;{" "}
                  {sub.status}
                  {sub.current_period_end &&
                    ` · Renews ${new Date(sub.current_period_end).toLocaleDateString("en-AU")}`}
                </p>
                <button
                    onClick={openPortal}
                    className="text-xs text-action-teal font-medium underline"
                  >
                    Manage subscription
                  </button>
              </div>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {key.tier === "free" && (
                  <>
                    <button
                      onClick={() => openCheckout(proPriceMonthly, key.id)}
                      disabled={isLoading}
                      className="rounded-lg bg-action-teal text-white font-bold text-xs px-4 py-2 disabled:opacity-50"
                    >
                      {isLoading ? "Loading..." : "Upgrade to Pro (A$99/mo)"}
                    </button>
                    <button
                      onClick={() => openCheckout(businessPriceMonthly, key.id)}
                      disabled={isLoading}
                      className="rounded-lg bg-deep-navy text-white font-bold text-xs px-4 py-2 disabled:opacity-50"
                    >
                      Upgrade to Business (A$449/mo)
                    </button>
                  </>
                )}
                {key.tier === "pro" && (
                  <button
                    onClick={() => openCheckout(businessPriceMonthly, key.id)}
                    disabled={isLoading}
                    className="rounded-lg bg-deep-navy text-white font-bold text-xs px-4 py-2 disabled:opacity-50"
                  >
                    Upgrade to Business (A$449/mo)
                  </button>
                )}
                {(key.tier === "enterprise" || key.tier === "custom") && (
                  <p className="text-xs text-gov-slate">
                    Enterprise plan &mdash; contact{" "}
                    <a
                      href="mailto:brendan@askarthur.au"
                      className="text-action-teal"
                    >
                      brendan@askarthur.au
                    </a>{" "}
                    to manage billing.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
