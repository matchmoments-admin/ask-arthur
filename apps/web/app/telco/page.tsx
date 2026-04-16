import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SectorHero from "@/components/landing/SectorHero";
import SPFMappingTable from "@/components/landing/SPFMappingTable";
import LeadCaptureForm from "@/components/landing/LeadCaptureForm";
import { Phone, Link2, Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "Scam Prevention for Telecommunications — Ask Arthur",
  description:
    "AI-powered scam detection for Australian telcos. Extend your Reducing Scam Calls Code compliance to meet SPF Act 2025 obligations.",
};

export default function TelcoPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[960px] mx-auto px-5 pt-16 pb-12">
        {/* Hero */}
        <SectorHero
          headline="Scam Prevention for Telecommunications"
          subheadline="Extend your Reducing Scam Calls Code compliance. SPF Act obligations go further — Ask Arthur extends your capability."
          sector="telco"
        />

        {/* Problem section */}
        <section className="mb-16">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
            The telco scam landscape
          </h2>
          <p className="text-gov-slate text-base mb-6">
            Australian telecommunications providers are on the front line of
            scam delivery. The Reducing Scam Calls Code was only the beginning
            — the SPF Act demands more.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="bg-warn-bg border border-warn-border rounded-2xl p-6">
              <p className="text-warn-heading text-2xl font-extrabold mb-1">
                ~10,000/day
              </p>
              <p className="text-warn-text text-sm">
                Scam calls blocked daily by TPG Telecom under Reducing Scam
                Calls Code
              </p>
            </div>
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-6">
              <p className="text-danger-heading text-2xl font-extrabold mb-1">
                $694,860
              </p>
              <p className="text-danger-text text-sm">
                ACMA penalty issued to Exetel for Reducing Scam Calls Code
                non-compliance
              </p>
            </div>
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-6">
              <p className="text-danger-heading text-2xl font-extrabold mb-1">
                $413,160
              </p>
              <p className="text-danger-text text-sm">
                ACMA penalty issued to Circles.Life for scam call compliance
                failures
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
            Extend your existing scam call blocking with AI-powered detection
            across SMS, URLs, and voice channels.
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <Phone size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Call and SMS Detection
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Analyse caller IDs, SMS sender IDs, and message content in real
                time. Detect scam patterns before they reach your customers.
              </p>
            </div>
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <Link2 size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                URL Filtering for SMS
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Scan URLs embedded in SMS messages against known threat
                databases and AI-powered phishing detection before delivery.
              </p>
            </div>
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <Shield size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Compliance Evidence
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Go beyond Reducing Scam Calls Code requirements. Generate SPF
                Act-ready evidence demonstrating proactive scam prevention
                measures.
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
            Six RESTful API endpoints. Integrate into your existing SMS gateway,
            call routing platform, or customer service tools with standard JSON
            requests.
          </p>
          <div className="bg-deep-navy rounded-2xl p-6 overflow-x-auto">
            <pre className="text-sm text-slate-300 font-mono leading-relaxed">
              <code>{`curl -X POST https://api.askarthur.au/v1/threat/check \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "phone",
    "value": "+61400000000",
    "context": "inbound_sms"
  }'

# Response
{
  "verdict": "SUSPICIOUS",
  "confidence": 0.78,
  "signals": ["spoofed_sender_id", "known_scam_pattern"],
  "recommendation": "Flag for review"
}`}</code>
            </pre>
          </div>
        </section>

        {/* Lead Capture */}
        <LeadCaptureForm
          source="telco_page"
          heading="Start your SPF compliance journey"
          description="Leave your details and our team will walk you through how Ask Arthur extends your existing scam prevention capability."
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
