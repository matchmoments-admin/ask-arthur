import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SectorHero from "@/components/landing/SectorHero";
import SPFMappingTable from "@/components/landing/SPFMappingTable";
import LeadCaptureForm from "@/components/landing/LeadCaptureForm";
import { ScanSearch, MessageSquareWarning, BarChart3 } from "lucide-react";

export const metadata: Metadata = {
  title: "Scam Prevention for Digital Platforms — Ask Arthur",
  description:
    "AI-powered scam detection for social media, paid search, and messaging platforms. Demonstrate reasonable steps under the SPF Act 2025.",
};

export default function DigitalPlatformsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[960px] mx-auto px-5 pt-16 pb-12">
        {/* Hero */}
        <SectorHero
          headline="Scam Prevention for Digital Platforms"
          subheadline="The SPF Act specifically targets social media, paid search, and messaging. Demonstrate reasonable steps before the ACCC comes looking."
          sector="digital_platform"
        />

        {/* Problem section */}
        <section className="mb-16">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
            Digital platforms under scrutiny
          </h2>
          <p className="text-gov-slate text-base mb-6">
            The ACCC has identified digital platforms as the primary delivery
            channel for scams targeting Australians. Regulatory action is
            accelerating.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="bg-danger-bg border border-danger-border rounded-2xl p-6">
              <p className="text-danger-heading text-2xl font-extrabold mb-1">
                #1 Channel
              </p>
              <p className="text-danger-text text-sm">
                Social media is the leading scam delivery channel by victim
                contact method in Australia
              </p>
            </div>
            <div className="bg-warn-bg border border-warn-border rounded-2xl p-6">
              <p className="text-warn-heading text-2xl font-extrabold mb-1">
                40% YoY
              </p>
              <p className="text-warn-text text-sm">
                Increase in scam advertisements on paid search and social media
                platforms
              </p>
            </div>
            <div className="bg-slate-50 border border-border-light rounded-2xl p-6">
              <p className="text-deep-navy text-2xl font-extrabold mb-1">
                $52.7M
              </p>
              <p className="text-gov-slate text-sm">
                Maximum civil penalty per contravention under the SPF Act for
                body corporates
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
            Automated scam detection for ads, user-generated content, and URLs
            shared on your platform.
          </p>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <ScanSearch size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Ad and Content Scanning
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Analyse ad copy, landing page URLs, and advertiser domains
                before publication. Flag scam patterns automatically at
                submission time.
              </p>
            </div>
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <MessageSquareWarning size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                URL and Link Checking
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Scan URLs shared in messages, comments, and profiles against
                known phishing databases and AI-powered threat detection in real
                time.
              </p>
            </div>
            <div className="bg-white border border-border-light rounded-2xl p-6">
              <div className="w-10 h-10 bg-trust-teal/10 rounded-xl flex items-center justify-center mb-4">
                <BarChart3 size={20} className="text-trust-teal" />
              </div>
              <h3 className="text-deep-navy text-base font-bold mb-2">
                Content Moderation Support
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                Provide your trust and safety teams with scam confidence scores
                and structured evidence to support takedown decisions and
                regulatory reporting.
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
            Six RESTful API endpoints. Integrate into your ad review pipeline,
            content moderation queue, or link-scanning middleware with standard
            JSON requests.
          </p>
          <div className="bg-deep-navy rounded-2xl p-6 overflow-x-auto">
            <pre className="text-sm text-slate-300 font-mono leading-relaxed">
              <code>{`curl -X POST https://api.askarthur.au/v1/threat/check \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "type": "url",
    "value": "https://ad-landing-page.example.com",
    "context": "ad_review"
  }'

# Response
{
  "verdict": "HIGH_RISK",
  "confidence": 0.91,
  "signals": ["impersonation", "fake_investment_scheme"],
  "recommendation": "Reject ad and suspend advertiser"
}`}</code>
            </pre>
          </div>
        </section>

        {/* Lead Capture */}
        <LeadCaptureForm
          source="digital_platforms_page"
          heading="Start your SPF compliance journey"
          description="Leave your details and our team will walk you through how Ask Arthur integrates with your trust and safety workflows."
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
