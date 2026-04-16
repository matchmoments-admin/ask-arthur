import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SectorHero from "@/components/landing/SectorHero";
import SPFMappingTable from "@/components/landing/SPFMappingTable";
import LeadCaptureForm from "@/components/landing/LeadCaptureForm";
import { ShieldAlert, FileText, CheckSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "Scam Prevention for Banks — Ask Arthur",
  description:
    "AI-powered scam detection for Australian banks. Meet SPF Act 2025 obligations with automated threat detection, compliance reporting, and audit trails.",
};

export default function BankingPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[960px] mx-auto px-5 pt-16 pb-12">
        {/* Hero */}
        <SectorHero
          headline="Scam Prevention for Australian Banks"
          subheadline="Meet your SPF Act obligations with AI-powered threat detection. Penalties up to $52.7M take effect July 2026."
          sector="banking"
        />

        {/* Problem section */}
        <section className="mb-16">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
            Banking sector scam losses
          </h2>
          <p className="text-gov-slate text-base mb-6">
            Australian banks face mounting regulatory pressure as scam losses
            continue to climb and detection rates remain critically low.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-6">
              <p className="text-danger-heading text-2xl font-extrabold mb-1">
                $837.7M
              </p>
              <p className="text-danger-text text-sm">
                Investment scam losses reported to Scamwatch in 2025
              </p>
            </div>
            <div className="bg-warn-bg border border-warn-border rounded-2xl p-6">
              <p className="text-warn-heading text-2xl font-extrabold mb-1">
                13%
              </p>
              <p className="text-warn-text text-sm">
                Of scam payments detected by Big Four banks before settlement
              </p>
            </div>
            <div className="bg-slate-50 border border-border-light rounded-2xl p-6">
              <p className="text-deep-navy text-2xl font-extrabold mb-1">
                2-5%
              </p>
              <p className="text-gov-slate text-sm">
                Customer reimbursement rate across major Australian banks
              </p>
            </div>
          </div>
        </section>

        {/* Solution section */}
        <section className="mb-16">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
            How Ask Arthur helps
          </h2>
          <p className="text-gov-slate text-base mb-6">
            A single API that gives your fraud and compliance teams the
            capability to detect, report, and demonstrate compliance.
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <ShieldAlert size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Detect
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Analyse URLs, phone numbers, email addresses, and domains in
                real time. Flag suspicious payees before payment authorisation.
              </p>
            </div>
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <FileText size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Report
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Generate ACCC and ASIC-ready incident reports automatically.
                Maintain a complete audit trail of every scam check performed.
              </p>
            </div>
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <CheckSquare size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Comply
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Export compliance evidence mapped to SPF Act principles.
                Demonstrate &ldquo;reasonable steps&rdquo; to regulators with
                structured data.
              </p>
            </div>
          </div>
        </section>

        {/* SPF Mapping */}
        <SPFMappingTable />

        {/* Integration section */}
        <section className="mb-16">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
            Live in under a day
          </h2>
          <p className="text-gov-slate text-base mb-6">
            Six RESTful API endpoints. Standard JSON responses. No proprietary
            SDKs required. Your engineering team can integrate Ask Arthur into
            existing fraud detection workflows in hours.
          </p>
          <div className="bg-deep-navy rounded-2xl p-6 overflow-x-auto">
            <pre className="text-sm text-slate-300 font-mono leading-relaxed">
              <code>{`curl -X POST https://api.askarthur.au/v1/threat/check \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "url",
    "value": "https://suspicious-site.example.com",
    "context": "customer_reported"
  }'

# Response
{
  "verdict": "HIGH_RISK",
  "confidence": 0.94,
  "signals": ["known_phishing_domain", "recently_registered"],
  "recommendation": "Block and report to ACCC"
}`}</code>
            </pre>
          </div>
        </section>

        {/* Lead Capture */}
        <LeadCaptureForm
          source="banking_page"
          heading="Start your SPF compliance journey"
          description="Leave your details and our team will walk you through how Ask Arthur maps to your banking obligations."
        />

        {/* Footer stats */}
        <section className="text-center py-8 border-t border-border-light">
          <p className="text-gov-slate text-sm font-medium">
            Trusted by organisations across Australia
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
