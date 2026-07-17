import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { AssessmentWizard } from "@/components/assessment/AssessmentWizard";

export const metadata: Metadata = {
  title: "SPF Readiness Assessment — 31 March 2027 Code Commencement — Ask Arthur",
  description:
    "Free assessment for compliance teams: SPF sector codes, record-keeping obligations and AFCA's scam complaint jurisdiction all commence 31 March 2027. Check your readiness across all 6 SPF principles.",
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
