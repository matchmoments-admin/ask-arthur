import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import PricingTiers from "@/components/PricingTiers";

export const metadata: Metadata = {
  title: "API Pricing — Ask Arthur",
  description:
    "Threat intelligence API pricing. Free tier included. Pro and Enterprise plans for higher volume scam detection.",
};

export default function PricingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        <h1 className="text-deep-navy text-3xl font-extrabold mb-3">
          API Pricing
        </h1>
        <p className="text-gov-slate text-base leading-relaxed mb-10">
          Real-time Australian scam and threat intelligence. Start free, upgrade
          when you need more.
        </p>

        <PricingTiers />
      </main>

      <Footer />
    </div>
  );
}
