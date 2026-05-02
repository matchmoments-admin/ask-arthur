import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import CharityChecker from "@/components/CharityChecker";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Charity Legitimacy Check — Is This Charity Real? | Ask Arthur",
  description:
    "Before you tap your card or sign anything, take 20 seconds. Type the charity name or ABN and Arthur will check it against the ACNC register, the ATO's deductible-gift list, and Australia's fundraising regulator.",
};

export default function CharityCheckPage() {
  // Server-side gate. The page returns 404 when the flag is OFF so we can
  // ship the route + components without exposing them in production.
  if (!featureFlags.charityCheck) {
    notFound();
  }

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
        <CharityChecker />
      </main>
      <Footer />
    </div>
  );
}
