import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { AssessmentWizard } from "@/components/assessment/AssessmentWizard";

export const metadata: Metadata = {
  title: "SPF Compliance Readiness Assessment — Ask Arthur",
  description:
    "Free assessment: how prepared is your organisation for Australia's Scams Prevention Framework Act 2025? Check your readiness across all 6 SPF principles.",
};

export default function SpfAssessmentPage() {
  return (
    <>
      <Nav />
      <main className="max-w-[640px] mx-auto px-5 py-16">
        <AssessmentWizard />
      </main>
      <Footer />
    </>
  );
}
