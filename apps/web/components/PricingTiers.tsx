"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { initializePaddle } from "@paddle/paddle-js";
import type { Paddle } from "@paddle/paddle-js";
import { TIER_LIMITS } from "@askarthur/types/billing";

const proPriceId = process.env.NEXT_PUBLIC_PADDLE_PRO_PRICE_ID ?? "";
const enterprisePriceId =
  process.env.NEXT_PUBLIC_PADDLE_ENTERPRISE_PRICE_ID ?? "";

export default function PricingTiers() {
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

  function openCheckout(priceId: string) {
    if (!paddle) return;
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
    });
  }

  return (
    <div className="space-y-5">
      {/* Free */}
      <div className="rounded-xl border border-border-light bg-white p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-deep-navy text-xl font-extrabold">Free</h2>
          <span className="text-deep-navy font-extrabold text-2xl">$0</span>
        </div>
        <ul className="space-y-2 text-gov-slate text-sm mb-6">
          <li className="flex items-center gap-2">
            <Check />
            {TIER_LIMITS.free.dailyLimit} requests / day
          </li>
          <li className="flex items-center gap-2">
            <Check />
            {TIER_LIMITS.free.ratePerMinute} RPM
          </li>
          <li className="flex items-center gap-2">
            <Check />
            Batch size up to {TIER_LIMITS.free.maxBatchSize}
          </li>
          <li className="flex items-center gap-2">
            <Check />
            All endpoints included
          </li>
        </ul>
        <Link
          href="/api-docs"
          className="block w-full text-center rounded-lg border-2 border-deep-navy text-deep-navy font-bold text-sm py-2.5 hover:bg-deep-navy/5 transition-colors"
        >
          Get Started
        </Link>
      </div>

      {/* Pro */}
      <div className="rounded-xl border-2 border-action-teal bg-white p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-deep-navy text-xl font-extrabold">Pro</h2>
          <div className="text-right">
            <span className="text-deep-navy font-extrabold text-2xl">
              $49
            </span>
            <span className="text-gov-slate text-sm font-medium"> / mo</span>
          </div>
        </div>
        <p className="text-gov-slate text-xs mb-4">
          For teams integrating threat intelligence into their products.
        </p>
        <ul className="space-y-2 text-gov-slate text-sm mb-6">
          <li className="flex items-center gap-2">
            <Check />
            {TIER_LIMITS.pro.dailyLimit} requests / day
          </li>
          <li className="flex items-center gap-2">
            <Check />
            {TIER_LIMITS.pro.ratePerMinute} RPM
          </li>
          <li className="flex items-center gap-2">
            <Check />
            Batch size up to {TIER_LIMITS.pro.maxBatchSize}
          </li>
          <li className="flex items-center gap-2">
            <Check />
            Priority support
          </li>
        </ul>
        <button
          onClick={() => openCheckout(proPriceId)}
          disabled={!paddle}
          className="w-full rounded-lg bg-action-teal text-white font-bold text-sm py-2.5 hover:bg-action-teal/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Subscribe to Pro
        </button>
      </div>

      {/* Enterprise */}
      <div className="rounded-xl border border-border-light bg-white p-6">
        <div className="flex items-baseline justify-between mb-1">
          <h2 className="text-deep-navy text-xl font-extrabold">Enterprise</h2>
          <div className="text-right">
            <span className="text-deep-navy font-extrabold text-2xl">
              $249
            </span>
            <span className="text-gov-slate text-sm font-medium"> / mo</span>
          </div>
        </div>
        <p className="text-gov-slate text-xs mb-4">
          For organisations needing high-volume threat data at scale.
        </p>
        <ul className="space-y-2 text-gov-slate text-sm mb-6">
          <li className="flex items-center gap-2">
            <Check />
            {TIER_LIMITS.enterprise.dailyLimit.toLocaleString()} requests / day
          </li>
          <li className="flex items-center gap-2">
            <Check />
            {TIER_LIMITS.enterprise.ratePerMinute} RPM
          </li>
          <li className="flex items-center gap-2">
            <Check />
            Batch size up to {TIER_LIMITS.enterprise.maxBatchSize}
          </li>
          <li className="flex items-center gap-2">
            <Check />
            Dedicated support + SLA
          </li>
        </ul>
        <button
          onClick={() => openCheckout(enterprisePriceId)}
          disabled={!paddle}
          className="w-full rounded-lg bg-deep-navy text-white font-bold text-sm py-2.5 hover:bg-deep-navy/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Subscribe to Enterprise
        </button>
      </div>
    </div>
  );
}

function Check() {
  return (
    <svg
      className="w-4 h-4 text-action-teal flex-shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
