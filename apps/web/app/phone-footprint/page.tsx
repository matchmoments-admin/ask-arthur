// /phone-footprint — landing + inline lookup form.
// Gated by NEXT_PUBLIC_FF_PHONE_FOOTPRINT_CONSUMER. While the flag is off
// this page returns a 404 via notFound() so the route is invisible.

import { notFound } from "next/navigation";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { LookupForm } from "./LookupForm";

export const metadata = {
  title: "Phone Footprint — Ask Arthur",
  description:
    "Check what's known about an Australian phone number: scam reports, breach exposure, SIM swap history, and live fraud score.",
};

export default function PhoneFootprintLanding() {
  if (!featureFlags.phoneFootprintConsumer) {
    notFound();
  }

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
          Look up any Australian mobile or landline to see scam-report activity,
          data-breach exposure, carrier identity signals, and — for your own
          number — recent SIM-swap events. Results for numbers you don&rsquo;t own
          are shown as a summary only.
        </p>
      </header>

      <LookupForm />

      <section className="mt-12 space-y-3 text-sm text-gray-600">
        <h2 className="text-sm font-semibold text-gray-900">How this works</h2>
        <p>
          Ask Arthur queries up to five data sources in parallel: our own
          community scam reports, LeakCheck&rsquo;s breach corpus, Vonage&rsquo;s
          fraud score and SIM-swap signal, IPQS&rsquo;s phone reputation, and
          Twilio&rsquo;s carrier identity data. We weight each signal into a 0-100
          score and a safe / caution / high / critical band.
        </p>
        <p>
          To see the full detail of a number, you need to prove ownership via
          a one-time SMS verification code — this keeps Phone Footprint honest
          as a self-lookup product and out of the territory of third-party
          surveillance tools.
        </p>
      </section>
    </main>
  );
}
