import { Suspense } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CharityChecker from "@/components/CharityChecker";
import { gateOrNotFound } from "@/lib/featureGate";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Charity Legitimacy Check — Is This Charity Real? | Ask Arthur",
  description:
    "Before you tap your card or sign anything, take 20 seconds. Type the charity name or ABN and Arthur will check it against the ACNC register, the ATO's deductible-gift list, and Australia's fundraising regulator.",
};

// Feature gates must be evaluated per REQUEST, not per build. Without this a
// statically prerendered route bakes the flag's build-time value into HTML: the
// page keeps serving 200 after the flag is turned off, and stays 404 after it is
// turned on until something triggers a rebuild. That is not hypothetical —
// /charity-check served 200 while both of its API routes returned 503
// feature_disabled, so every search a user ran failed. Enforced by
// __tests__/featureGateRuntime.test.ts.
export const dynamic = "force-dynamic";

export default function CharityCheckPage() {
  // Server-side gate. Returns 404 when NEXT_PUBLIC_FF_CHARITY_CHECK is OFF
  // so we can ship the route + components without exposing them in prod.
  gateOrNotFound("charityCheck");

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Is This Charity Real?
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Before you tap your card or sign anything, take 20 seconds.
          Type the charity name or ABN and Arthur will check it against the
          ACNC register, the ATO&rsquo;s deductible-gift list, and Australia&rsquo;s
          fundraising regulator.
        </p>
        <Suspense>
          <CharityChecker />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
