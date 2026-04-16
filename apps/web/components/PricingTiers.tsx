"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Clock } from "lucide-react";

type BillingInterval = "monthly" | "annual";

const TIERS = [
  {
    id: "free",
    name: "Free",
    tagline: "Evaluate the API — no commitment",
    monthlyAud: 0,
    annualAud: 0,
    highlight: false,
    cta: "Get API key",
    ctaHref: "/app/keys",
    ctaAction: null as null | "checkout",
    stripePriceMonthly: null as null | string,
    stripePriceAnnual: null as null | string,
    limits: { requestsPerDay: 25, rpm: 60, batch: 10 },
    features: [
      { text: "All 6 API endpoints", available: true },
      { text: "Risk score (0-100) + Low/Med/High/Critical", available: true },
      { text: "Australian scam taxonomy", available: true },
      { text: "1 API key", available: true },
      { text: "Full enrichment data (5 sources)", available: false },
      { text: "14 Australian threat feeds", available: false },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "Ship scam detection into your product",
    monthlyAud: 99,
    annualAud: 990,
    highlight: false,
    cta: "Start 14-day trial",
    ctaHref: null,
    ctaAction: "checkout" as const,
    stripePriceMonthly: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY ?? "",
    stripePriceAnnual: process.env.NEXT_PUBLIC_STRIPE_PRO_ANNUAL ?? "",
    limits: { requestsPerDay: 200, rpm: 120, batch: 100 },
    features: [
      { text: "All 6 API endpoints", available: true },
      { text: "Full enrichment: AbuseIPDB, HIBP, Twilio, URLScan, CT logs", available: true },
      { text: "14 Australian threat feeds + Scamwatch categories", available: true },
      { text: "3 API keys + analytics dashboard", available: true },
      { text: "Email support (48h AEST)", available: true },
      { text: "Fraud manager dashboard", available: false },
    ],
  },
  {
    id: "business",
    name: "Business",
    tagline: "For fraud teams with compliance deadlines",
    monthlyAud: 449,
    annualAud: 4490,
    highlight: true,
    cta: "Start 14-day trial",
    ctaHref: null,
    ctaAction: "checkout" as const,
    stripePriceMonthly: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY ?? "",
    stripePriceAnnual: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_ANNUAL ?? "",
    limits: { requestsPerDay: 2000, rpm: 300, batch: 500 },
    features: [
      { text: "Everything in Pro", available: true },
      { text: "Fraud manager dashboard (search, alerts, reports)", available: true },
      { text: "10 team seats with role-based access", available: true },
      { text: "Webhook delivery for high-risk alerts", available: true },
      { text: "SPF Act compliance dashboard", comingSoon: true },
      { text: "Priority support (24h) + Slack channel", available: true },
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For regulated institutions — custom-built",
    monthlyAud: null,
    annualAud: null,
    highlight: false,
    cta: "Talk to an expert",
    ctaHref: "/contact",
    ctaAction: null,
    stripePriceMonthly: null,
    stripePriceAnnual: null,
    limits: { requestsPerDay: 10000, rpm: 500, batch: 2000 },
    features: [
      { text: "Everything in Business", available: true },
      { text: "Custom volume + SLA (99.9% uptime guarantee)", available: true },
      { text: "Australian data residency (Sydney region)", available: true },
      { text: "STIX 2.1 export for SIEM integration", comingSoon: true },
      { text: "White-label scam checker embed", comingSoon: true },
      { text: "Dedicated account manager", available: true },
    ],
  },
];

export default function PricingTiers({
  apiKeyId,
  userId,
}: {
  apiKeyId?: number;
  userId?: string;
  userEmail?: string;
}) {
  const [interval, setInterval] = useState<BillingInterval>("annual");
  const [loading, setLoading] = useState<string | null>(null);
  const router = useRouter();

  async function handleCheckout(tier: (typeof TIERS)[number]) {
    if (!tier.ctaAction || !apiKeyId) {
      router.push("/app/keys");
      return;
    }
    const priceId =
      interval === "annual" ? tier.stripePriceAnnual : tier.stripePriceMonthly;
    if (!priceId) return;

    setLoading(tier.id);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, apiKeyId }),
      });
      const { url } = await res.json();
      if (url) router.push(url);
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Billing toggle */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border border-border-light bg-white p-1 gap-1">
          {(["monthly", "annual"] as const).map((int) => (
            <button
              key={int}
              onClick={() => setInterval(int)}
              className={`px-4 py-1.5 rounded-md text-sm font-bold transition-colors ${
                interval === int
                  ? "bg-deep-navy text-white"
                  : "text-gov-slate hover:text-deep-navy"
              }`}
            >
              {int === "monthly" ? "Monthly" : "Annual"}{" "}
              {int === "annual" && (
                <span className="text-xs text-action-teal font-bold">
                  (2 months free)
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
        {TIERS.map((tier) => {
          const price =
            tier.monthlyAud === null
              ? null
              : interval === "annual" && tier.annualAud > 0
                ? Math.round(tier.annualAud / 12)
                : tier.monthlyAud;

          return (
            <div
              key={tier.id}
              className={`rounded-xl border-2 bg-white p-5 flex flex-col ${
                tier.highlight
                  ? "border-action-teal shadow-lg scale-[1.02]"
                  : "border-border-light"
              }`}
            >
              {tier.highlight && (
                <div className="text-xs font-bold uppercase tracking-widest text-action-teal mb-3">
                  Most Popular
                </div>
              )}
              <h2 className="text-deep-navy font-extrabold text-lg">
                {tier.name}
              </h2>
              <p className="text-gov-slate text-xs mt-0.5 mb-4">
                {tier.tagline}
              </p>

              <div className="mb-4">
                {price === null ? (
                  <span className="text-deep-navy font-extrabold text-2xl">
                    Custom
                  </span>
                ) : price === 0 ? (
                  <span className="text-deep-navy font-extrabold text-2xl">
                    Free
                  </span>
                ) : (
                  <>
                    <span className="text-deep-navy font-extrabold text-2xl">
                      A${price}
                    </span>
                    <span className="text-gov-slate text-xs"> /mo</span>
                    {interval === "annual" && tier.annualAud !== null && tier.annualAud > 0 && (
                      <div className="text-xs text-gov-slate mt-0.5">
                        A${tier.annualAud.toLocaleString()}/year
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="text-xs text-gov-slate mb-4 space-y-0.5">
                <div>
                  {tier.limits.requestsPerDay.toLocaleString()} req/day
                </div>
                <div>
                  {tier.limits.rpm} RPM &middot; batch {tier.limits.batch}
                </div>
              </div>

              {tier.ctaAction ? (
                <button
                  onClick={() => handleCheckout(tier)}
                  disabled={loading === tier.id}
                  className={`w-full text-center rounded-lg font-bold text-sm py-2.5 mb-4 transition-colors ${
                    tier.highlight
                      ? "bg-action-teal text-white hover:bg-action-teal/90"
                      : "border-2 border-deep-navy text-deep-navy hover:bg-deep-navy/5"
                  } disabled:opacity-50`}
                >
                  {loading === tier.id ? "Loading..." : tier.cta}
                </button>
              ) : tier.ctaHref ? (
                <Link
                  href={tier.ctaHref}
                  className="block w-full text-center rounded-lg border-2 border-deep-navy text-deep-navy font-bold text-sm py-2.5 mb-4 hover:bg-deep-navy/5"
                >
                  {tier.cta}
                </Link>
              ) : null}

              <ul className="space-y-2 flex-1">
                {tier.features.map((f) => (
                  <li key={f.text} className="flex items-start gap-2 text-xs">
                    {f.available ? (
                      <CheckCircle
                        size={14}
                        className="text-emerald-500 flex-shrink-0 mt-0.5"
                      />
                    ) : "comingSoon" in f && f.comingSoon ? (
                      <Clock
                        size={14}
                        className="text-amber-400 flex-shrink-0 mt-0.5"
                      />
                    ) : (
                      <span className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 rounded-full border-2 border-slate-200" />
                    )}
                    <span
                      className={
                        f.available || ("comingSoon" in f && f.comingSoon)
                          ? "text-gov-slate"
                          : "text-slate-300"
                      }
                    >
                      {f.text}
                      {"comingSoon" in f && f.comingSoon && (
                        <span className="ml-1 text-amber-500 font-medium">
                          (soon)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-gov-slate">
        All prices in AUD + GST. 14-day money-back guarantee on Pro and Business
        plans.
      </p>
    </div>
  );
}
