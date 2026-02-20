import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Terms of Service — Ask Arthur",
  description:
    "Terms and conditions for using the Ask Arthur scam analysis service.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-800 font-bold">
            DRAFT — These terms are provided in draft form. Seek independent
            legal advice before relying on them.
          </p>
        </div>

        <h1 className="text-deep-navy text-3xl font-extrabold mb-8">
          Terms of Service
        </h1>

        <div className="prose-arthur space-y-8">
          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              1. Service Description
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              Ask Arthur is a free AI-powered scam analysis tool. You submit
              text, images, or URLs, and our AI analyses them for potential scam
              indicators. The service is provided as-is and is intended for
              informational purposes only.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              2. AI Disclaimer
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              All analysis provided by Ask Arthur is AI-generated and advisory
              only. Ask Arthur does not guarantee the accuracy, completeness, or
              reliability of any analysis. AI systems can make errors, and scam
              tactics evolve constantly. Always exercise your own judgment. If you
              believe you have encountered a scam, report it to{" "}
              <a
                href="https://www.scamwatch.gov.au"
                target="_blank"
                rel="noopener noreferrer"
                className="text-action-teal hover:underline"
              >
                Scamwatch
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              3. No Professional Advice
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              Ask Arthur does not provide legal, financial, or professional
              security advice. The analysis is not a substitute for advice from
              qualified professionals. If you have suffered financial loss, seek
              advice from your bank, a legal professional, or contact IDCARE
              (1800 595 160) for identity theft support.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              4. Limitation of Liability
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              To the maximum extent permitted by law, Ask Arthur and its
              operators are not liable for any loss, damage, or harm arising from
              your use of the service or reliance on its analysis.
            </p>
            <p className="text-gov-slate text-base leading-relaxed">
              Nothing in these terms excludes, restricts, or modifies any
              consumer guarantee, right, or remedy conferred by the Australian
              Consumer Law (Schedule 2 of the Competition and Consumer Act 2010)
              or any other applicable law that cannot be excluded, restricted, or
              modified by agreement.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              5. Acceptable Use
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              You agree not to:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2">
              <li>
                Use automated tools or scripts to submit bulk requests to the
                service
              </li>
              <li>
                Attempt to circumvent rate limits or other security measures
              </li>
              <li>
                Submit content that is illegal, abusive, or intended to harm
                others
              </li>
              <li>
                Reverse-engineer, decompile, or attempt to extract the AI
                prompts or models used by the service
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              6. Changes to These Terms
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              We may update these terms from time to time. Changes will be posted
              on this page with an updated date. Your continued use of Ask Arthur
              after changes are posted constitutes acceptance of the revised
              terms.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              7. Governing Law
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              These terms are governed by the laws of Australia. Any disputes
              arising from these terms or your use of Ask Arthur are subject to
              the jurisdiction of Australian courts.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              8. Contact
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              For questions about these terms, contact us at{" "}
              <a
                href="mailto:arthur.ask@outlook.com"
                className="text-action-teal hover:underline"
              >
                arthur.ask@outlook.com
              </a>
            </p>
          </section>

          <section>
            <p className="text-sm text-slate-400">
              Last updated: February 2025
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
