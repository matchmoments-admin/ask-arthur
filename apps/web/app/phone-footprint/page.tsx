// /phone-footprint — landing + inline lookup form.
// Gated by NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER. While the flag is off
// this page returns a 404 via notFound() so the route is invisible.
//
// International from launch: copy and feature claims are honest about
// per-country signal availability. SIM swap detection is real and
// carrier-authoritative in DE/IT/US/GB/BR/ES/FR/NL/CA via Vonage CAMARA;
// elsewhere (incl. AU today) we run a carrier-drift proxy off Twilio
// Lookup deltas. The LookupForm reads the response's `regional` block
// to surface the right copy after a lookup completes.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { LookupForm } from "./LookupForm";

export const metadata = {
  title: "Phone Footprint — Ask Arthur",
  description:
    "See what's known about your phone number: scam reports, data-breach exposure, live fraud score, SIM-swap detection, and carrier identity. Self-lookup only — verify ownership with a one-time SMS code.",
};

const CAMARA_COUNTRIES = new Set([
  "DE", "IT", "US", "GB", "BR", "ES", "FR", "NL", "CA",
]);

export default async function PhoneFootprintLanding() {
  if (!featureFlags.phoneFootprintConsumer) {
    notFound();
  }

  const hdrs = await headers();
  const callerCountry = hdrs.get("x-vercel-ip-country")?.toUpperCase() ?? null;
  const simSwapLive = callerCountry !== null && CAMARA_COUNTRIES.has(callerCountry);

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:py-20">
      <header className="mb-10 space-y-3">
        <p className="text-xs font-medium tracking-wider uppercase text-gray-500">
          Phone Footprint
        </p>
        <h1 className="font-serif text-3xl sm:text-4xl text-gray-900">
          What does your phone number know about you?
        </h1>
        <p className="max-w-2xl text-base text-gray-700">
          Look up your mobile or landline to see scam-report activity,
          data-breach exposure, live fraud score, carrier identity, and{" "}
          {simSwapLive ? "recent SIM-swap events" : "carrier-change activity"}.
          Numbers you don&rsquo;t own return a summary only — we&rsquo;re a
          self-lookup product, not a surveillance tool.
        </p>
      </header>

      <LookupForm />

      <section className="mt-12 space-y-4 text-sm text-gray-700">
        <h2 className="text-sm font-semibold text-gray-900">How this works</h2>
        <p>
          We query up to five data sources in parallel and weight the signals
          into a single 0–100 score with a safe / caution / high / critical
          band:
        </p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <strong>Community scam reports</strong> — has this number been
            reported to Ask Arthur or matched against a verified scam pattern?
          </li>
          <li>
            <strong>Breach exposure</strong> — does this number show up in
            known data breaches (LeakCheck for phone, HIBP for any linked
            email)?
          </li>
          <li>
            <strong>Live fraud reputation</strong> — Vonage&rsquo;s
            carrier-aware fraud score, with IPQS as a second-opinion fallback.
          </li>
          <li>
            <strong>
              {simSwapLive ? "SIM swap & device swap" : "Carrier-change activity"}
            </strong>
            {" — "}
            {simSwapLive
              ? "carrier-authoritative SIM swap detection via the Vonage CAMARA Open Gateway, available in your country."
              : "we track carrier-string and line-type changes between snapshots as a proxy. Full carrier-authoritative SIM swap detection is coming as more carriers join the GSMA Open Gateway."}
          </li>
          <li>
            <strong>Carrier identity</strong> — line type, carrier name,
            registered caller name, VoIP detection.
          </li>
        </ul>
        <p>
          To see the full per-pillar detail of a number, you need to prove
          ownership via a one-time SMS verification code. This keeps Phone
          Footprint honest as a self-lookup product and out of the territory
          of third-party surveillance tools.
        </p>
        {!simSwapLive && callerCountry && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <strong className="font-semibold">Coverage note:</strong> Full
            carrier-authoritative SIM swap detection isn&rsquo;t live in your
            country yet. We&rsquo;re actively adding carriers as they join the
            GSMA Open Gateway — Telstra has launched in Australia and others
            are following. Until then, we use carrier-change proxy detection
            for your monitored numbers.
          </div>
        )}
      </section>
    </main>
  );
}
