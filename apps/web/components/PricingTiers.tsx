"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle, Clock } from "lucide-react";
import HorizontalCard from "./HorizontalCard";

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
      { text: "Risk score + Low/Med/High/Critical", available: true },
      { text: "Australian scam taxonomy", available: true },
      { text: "1 API key", available: true },
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
      { text: "Full enrichment: AbuseIPDB, HIBP, Twilio, URLScan, CT logs", available: true },
      { text: "14 Australian threat feeds + Scamwatch categories", available: true },
      { text: "3 API keys + analytics dashboard", available: true },
      { text: "Email support (48h AEST)", available: true },
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
      { text: "Everything in Pro + fraud manager dashboard", available: true },
      { text: "10 team seats with role-based access", available: true },
      { text: "Webhook delivery for high-risk alerts", available: true },
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
      { text: "Custom volume + SLA (99.9% uptime)", available: true },
      { text: "Australian data residency (Sydney region)", available: true },
      { text: "STIX 2.1 export for SIEM integration", comingSoon: true },
      { text: "Dedicated account manager", available: true },
    ],
  },
];

export default function PricingTiers({
  apiKeyId,
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
    <div className="space-y-6">
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
                <span className="text-xs text-emerald-600 font-bold">
                  (2 months free)
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tier cards */}
      <ul className="space-y-4 list-none p-0 m-0">
        {TIERS.map((tier) => {
          const price =
            tier.monthlyAud === null
              ? null
              : interval === "annual" && tier.annualAud > 0
                ? Math.round(tier.annualAud / 12)
                : tier.monthlyAud;

          const meta = (
            <>
              <ul className="grid grid-cols-1 gap-1.5 list-none p-0 m-0">
                {tier.features.map((f) => (
                  <li key={f.text} className="flex items-start gap-2 text-xs">
                    {f.available ? (
                      <CheckCircle
                        size={13}
                        className="text-emerald-500 shrink-0 mt-0.5"
                      />
                    ) : "comingSoon" in f && f.comingSoon ? (
                      <Clock
                        size={13}
                        className="text-amber-400 shrink-0 mt-0.5"
                      />
                    ) : (
                      <span className="w-3 h-3 shrink-0 mt-0.5 rounded-full border-2 border-slate-200" />
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
              <p className="mt-3 text-[10px] text-slate-400">
                {tier.limits.requestsPerDay.toLocaleString()} req/day &middot;{" "}
                {tier.limits.rpm} RPM &middot; batch {tier.limits.batch}
              </p>
            </>
          );

          const trailing = (
            <div className="flex flex-col items-stretch md:items-end gap-2">
              <div className="md:text-right">
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
                    {interval === "annual" &&
                      tier.annualAud !== null &&
                      tier.annualAud > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          A${tier.annualAud.toLocaleString()}/year
                        </div>
                      )}
                  </>
                )}
              </div>

              {tier.ctaAction ? (
                <button
                  onClick={() => handleCheckout(tier)}
                  disabled={loading === tier.id}
                  className="w-full text-center rounded-lg bg-deep-navy text-white font-bold text-sm py-2.5 px-5 hover:bg-deep-navy/90 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2"
                >
                  {loading === tier.id ? "Loading..." : tier.cta}
                </button>
              ) : tier.ctaHref ? (
                <Link
                  href={tier.ctaHref}
                  className="block w-full text-center rounded-lg bg-deep-navy text-white font-bold text-sm py-2.5 px-5 hover:bg-deep-navy/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-navy focus-visible:ring-offset-2"
                >
                  {tier.cta}
                </Link>
              ) : null}
            </div>
          );

          return (
            <li key={tier.id}>
              <HorizontalCard
                size="lg"
                title={tier.name}
                description={tier.tagline}
                highlighted={tier.highlight}
                badge={tier.highlight ? "Popular" : undefined}
                meta={meta}
                trailing={trailing}
              />
            </li>
          );
        })}
      </ul>

      <p className="text-center text-xs text-gov-slate">
        Start with a 14-day free trial. Cancel anytime. All prices in AUD + GST.
      </p>
    </div>
  );
}
