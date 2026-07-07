import { BRAND_PLANS } from "@askarthur/types/billing";
import { CheckCircle } from "lucide-react";

/**
 * Brand Protection pricing (Wave 3). A distinct product from the API tiers
 * (PricingTiers) — billed on brands + takedowns, not API volume — so it renders
 * as its own section, reusing the same card/type styling. The partnership pilot
 * (police / government) is sales-led and shown as a footnote CTA, never a
 * self-serve card. Source of truth: BRAND_PLANS in @askarthur/types/billing.
 */

const BOOKING = process.env.NEXT_PUBLIC_BOOKING_URL || "/contact";

const publicPlans = [
  BRAND_PLANS.brand_monitor,
  BRAND_PLANS.brand_monitor_plus,
  BRAND_PLANS.brand_enterprise,
];

function priceLabel(monthlyAud: number | null): string {
  return monthlyAud === null ? "Custom" : `A$${monthlyAud.toLocaleString("en-AU")}`;
}

export default function BrandProtectionTiers() {
  return (
    <section className="mt-16">
      <h2 className="text-deep-navy mb-2 text-2xl font-extrabold">
        Brand Protection
      </h2>
      <p className="text-gov-slate mb-8 text-base leading-relaxed">
        Continuous lookalike-domain monitoring, an evidence dashboard, and managed
        takedowns for your brand — the paid tier of Clone Watch.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {publicPlans.map((plan) => (
          <div
            key={plan.key}
            className="flex flex-col rounded-xl border p-5"
            style={{
              borderColor:
                plan.key === "brand_monitor_plus"
                  ? "var(--color-deep-navy, #0b2545)"
                  : "var(--color-line)",
            }}
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
              <li className="flex items-center gap-2 text-[13px]">
                <CheckCircle size={14} className="shrink-0" />
                {plan.brands === null
                  ? "Portfolio of brands"
                  : `${plan.brands} brand${plan.brands === 1 ? "" : "s"} monitored`}
              </li>
              <li className="flex items-center gap-2 text-[13px]">
                <CheckCircle size={14} className="shrink-0" />
                {plan.takedownsPerMonth === null
                  ? "Unlimited in-scope takedowns"
                  : `${plan.takedownsPerMonth} managed takedowns / mo`}
              </li>
              <li className="flex items-center gap-2 text-[13px]">
                <CheckCircle size={14} className="shrink-0" />
                Evidence dashboard + monthly report
              </li>
            </ul>
            <a
              href={BOOKING}
              className="mt-5 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold"
              style={{
                background:
                  plan.motion === "contact"
                    ? "var(--color-surface, #fff)"
                    : "var(--color-deep-navy, #0b2545)",
                color:
                  plan.motion === "contact"
                    ? "var(--color-deep-navy, #0b2545)"
                    : "#fff",
                border: "1px solid var(--color-deep-navy, #0b2545)",
                textDecoration: "none",
              }}
            >
              {plan.motion === "contact" ? "Contact sales" : "Book a demo"}
            </a>
          </div>
        ))}
      </div>

      {/* Sales-led partnership pilot — police / government / non-profit. */}
      <div
        className="mt-4 rounded-xl border border-dashed p-5"
        style={{ borderColor: "var(--color-line)" }}
      >
        <p className="text-deep-navy text-sm font-bold">
          {BRAND_PLANS.brand_pilot.name} · from A$
          {BRAND_PLANS.brand_pilot.monthlyAud}/mo
        </p>
        <p className="text-gov-slate mt-1 text-[13px] leading-snug">
          {BRAND_PLANS.brand_pilot.blurb}{" "}
          <a href={BOOKING} style={{ color: "var(--color-link, #1a56db)" }}>
            Talk to us about a pilot →
          </a>
        </p>
      </div>
    </section>
  );
}
