import type { Metadata } from "next";
import { SpfChecker } from "./SpfChecker";

export const metadata: Metadata = {
  title: "SPF Compliance Checker — Ask Arthur",
  description:
    "Free SPF, DMARC, and DKIM compliance checker for Australian businesses. Protect your domain from email spoofing.",
};

export default function SpfCompliancePage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-16">
      {/* Hero */}
      <section className="text-center mb-16">
        <h1 className="text-4xl font-bold text-deep-navy mb-4">
          Is Your Domain Protected from Email Spoofing?
        </h1>
        <p className="text-lg text-gov-slate max-w-2xl mx-auto">
          Check your SPF, DMARC, and DKIM records in seconds. Protect your
          business from phishing attacks that impersonate your brand.
        </p>
      </section>

      {/* Live checker */}
      <section className="mb-16">
        <SpfChecker />
      </section>

      {/* Why it matters */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold text-deep-navy mb-6">
          Why Email Authentication Matters
        </h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-surface rounded-xl p-6">
            <h3 className="font-semibold text-deep-navy mb-2">
              Prevent Impersonation
            </h3>
            <p className="text-gov-slate text-sm">
              Without SPF/DMARC, attackers can send emails that appear to come
              from your domain. Customers trust these emails and fall for scams.
            </p>
          </div>
          <div className="bg-surface rounded-xl p-6">
            <h3 className="font-semibold text-deep-navy mb-2">
              Improve Deliverability
            </h3>
            <p className="text-gov-slate text-sm">
              Major email providers (Gmail, Outlook) now require SPF and DKIM.
              Missing records mean your legitimate emails go to spam.
            </p>
          </div>
          <div className="bg-surface rounded-xl p-6">
            <h3 className="font-semibold text-deep-navy mb-2">
              Meet Compliance
            </h3>
            <p className="text-gov-slate text-sm">
              Australian regulators and industry bodies increasingly require
              email authentication as a baseline security control.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center bg-deep-navy text-white rounded-2xl p-12">
        <h2 className="text-2xl font-bold mb-4">
          Need Help Fixing Your Records?
        </h2>
        <p className="text-slate-300 mb-6 max-w-lg mx-auto">
          Our API can continuously monitor your email authentication and alert
          you to misconfigurations before attackers exploit them.
        </p>
        <a
          href="/api-docs"
          className="inline-block bg-action-teal text-deep-navy font-semibold px-8 py-3 rounded-xl hover:bg-action-teal/90 transition-colors"
        >
          Explore the API
        </a>
      </section>
    </main>
  );
}
