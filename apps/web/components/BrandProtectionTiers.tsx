import { BRAND_PLANS } from "@askarthur/types/billing";
import { CheckCircle } from "lucide-react";
import { ENTITLEMENT_PROMISES } from "@/lib/clone-watch/brand-subscriber";

/**
 * Brand Protection pricing. A distinct product from the API tiers
 * (PricingTiers) — billed per brand, not API volume — so it renders as its own
 * section, reusing the same card/type styling.
 *
 * #1295 (founder, 2026-10-13): only the manual A$300 pilot is sold until the
 * first customer, so only plans with `public: true` render (today: the pilot)
 * and everything larger is a "talk to us" line. The feature list is
 * ENTITLEMENT_PROMISES from the Brand Subscriber Module — one line per
 * entitlement the code checks, nothing else — so this page cannot promise a
 * behaviour nothing enforces. Source of truth for plans: BRAND_PLANS.
 */

const BOOKING = process.env.NEXT_PUBLIC_BOOKING_URL || "/contact";

/** The plans the public page shows, in BRAND_PLANS order. */
export const PUBLIC_BRAND_PLANS = Object.values(BRAND_PLANS).filter(
  (p) => p.public,
);

/** The promise lines, in a fixed order; null promises are not rendered. */
export const BRAND_PROMISE_LINES = (
  [
    "priorityRescan",
    "weaponisedAlert",
    "monthlyReport",
    "managedTakedowns",
    "brandPage",
  ] as const
)
  .map((k) => ENTITLEMENT_PROMISES[k])
  .filter((line): line is string => line !== null);

function priceLabel(monthlyAud: number | null): string {
  return monthlyAud === null
    ? "Custom"
    : `A$${monthlyAud.toLocaleString("en-AU")}`;
}

export default function BrandProtectionTiers() {
  return (
    <section className="mt-16">
      <h2 className="text-deep-navy mb-2 text-2xl font-extrabold">
        Brand Protection
      </h2>
      <p className="text-gov-slate mb-8 text-base leading-relaxed">
        Clone Watch finds lookalike domains of Australian brands every day. The
        brand protection pilot puts your brand at the front of that work.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {PUBLIC_BRAND_PLANS.map((plan) => (
          <div
            key={plan.key}
            className="flex flex-col rounded-xl border p-5"
            style={{ borderColor: "var(--color-deep-navy, #0b2545)" }}
          >
            <p className="text-deep-navy text-lg font-bold">{plan.name}</p>
            <p className="text-deep-navy mt-1 text-2xl font-extrabold">
              {priceLabel(plan.monthlyAud)}
              {plan.monthlyAud !== null && (
                <span className="text-gov-slate text-sm font-medium">/mo</span>
              )}
            </p>
            <p className="text-gov-slate mt-2 text-[13px] leading-snug">
              {plan.blurb}
            </p>
            <ul className="mt-4 flex-1 space-y-1.5">
              {BRAND_PROMISE_LINES.map((line) => (
                <li key={line} className="flex items-start gap-2 text-[13px]">
                  <CheckCircle size={14} className="mt-0.5 shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
            <a
              href={BOOKING}
              className="mt-5 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold"
              style={{
                background: "var(--color-deep-navy, #0b2545)",
                color: "#fff",
                border: "1px solid var(--color-deep-navy, #0b2545)",
                textDecoration: "none",
              }}
            >
              Talk to us about a pilot
            </a>
          </div>
        ))}

        <div
          className="flex flex-col justify-center rounded-xl border border-dashed p-5"
          style={{ borderColor: "var(--color-line)" }}
        >
          <p className="text-deep-navy text-sm font-bold">
            More than one brand?
          </p>
          <p className="text-gov-slate mt-1 text-[13px] leading-snug">
            Banks, telcos, super funds and retailers with a portfolio of brands
            —{" "}
            <a href={BOOKING} style={{ color: "var(--color-link, #1a56db)" }}>
              talk to us →
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
