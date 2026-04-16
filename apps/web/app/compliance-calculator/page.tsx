import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { CostCalculator } from "@/components/calculator/CostCalculator";

export const metadata: Metadata = {
  title: "SPF Non-Compliance Cost Calculator — Ask Arthur",
  description:
    "Calculate your organisation's penalty exposure under Australia's Scams Prevention Framework Act 2025. Free calculator for banks, telcos, and digital platforms.",
};

export default function ComplianceCalculatorPage() {
  return (
    <>
      <Nav />
      <main className="max-w-[640px] mx-auto px-5 py-16">
        <CostCalculator />
      </main>
      <Footer />
    </>
  );
}
