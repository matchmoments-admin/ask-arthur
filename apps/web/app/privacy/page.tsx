import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Privacy Policy — Ask Arthur",
  description:
    "How Ask Arthur collects, uses, and protects your information under the Australian Privacy Act 1988.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-8 leading-tight text-center">
          Privacy Policy
        </h1>

        <div className="prose-arthur space-y-8">
          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              1. Information We Collect
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              When you use Ask Arthur, we may process the following information:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2">
              <li>
                <strong>Submitted text and images</strong> — processed by our AI
                for scam analysis, then immediately discarded. We do not retain
                the content you submit.
              </li>
              <li>
                <strong>IP address</strong> — hashed for rate limiting purposes
                only. Your raw IP address is never stored.
              </li>
              <li>
                <strong>Analytics</strong> — we use Plausible Analytics, a
                privacy-first analytics tool that collects no personal data and
                uses no cookies.
              </li>
              <li>
                <strong>Email address</strong> — only if you voluntarily
                subscribe to our mailing list.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              2. How We Use Your Information
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              Your submitted content is sent to our AI (Anthropic Claude API)
              for scam analysis. The analysis result is returned to you
              immediately, and your original content is discarded.
            </p>
            <p className="text-gov-slate text-base leading-relaxed">
              Aggregated, PII-scrubbed scam patterns (e.g. verdict counts by
              region) may be retained for research and to improve the service.
              These records contain no personal information.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              3. Cross-Border Data Transfers (APP 8)
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              To provide this service, your data may be processed by the
              following overseas providers:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2">
              <li>
                <strong>Anthropic</strong> (United States) — AI analysis of
                submitted content
              </li>
              <li>
                <strong>Supabase</strong> (United States) — database
                infrastructure for aggregated statistics and subscriber emails
              </li>
              <li>
                <strong>Cloudflare</strong> (United States / global) — content
                delivery and security
              </li>
              <li>
                <strong>Vercel</strong> (United States) — application hosting
              </li>
            </ul>
            <p className="text-gov-slate text-base leading-relaxed mt-3">
              We take reasonable steps to ensure these providers handle your
              information in accordance with the Australian Privacy Principles.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              4. Chrome Extension
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              The Ask Arthur Chrome extension is an optional companion to the
              web app. This section describes what the extension reads, what it
              sends to our API, and what it does not.
            </p>

            <p className="text-gov-slate text-base leading-relaxed mb-2 font-semibold">
              Permissions and what they are used for:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2 mb-4">
              <li>
                <strong>activeTab</strong> — reads the URL of the current tab
                only when you click the popup or trigger the right-click
                &ldquo;Check with Ask Arthur&rdquo; menu.
              </li>
              <li>
                <strong>contextMenus</strong> — registers the right-click menu
                item.
              </li>
              <li>
                <strong>storage</strong> — local, on-device preferences only
                (daily check count, dismissed warnings). Nothing is synced
                off-device.
              </li>
              <li>
                <strong>alarms</strong> — resets the daily check counter once
                per day.
              </li>
              <li>
                <strong>management</strong> (optional, opt-in) — requested only
                when you open the Extension Security Scanner tab. Reads the
                list of installed extension IDs so they can be audited for
                known risks. No extension content or user data is transmitted.
              </li>
              <li>
                <strong>Facebook host permissions</strong>
                {" ("}
                <code className="text-sm">
                  www.facebook.com, m.facebook.com, web.facebook.com
                </code>
                {") "}
                — used by the Facebook Ads scanner to inspect sponsored posts
                for scam signals. Posts are reduced to structural fingerprints
                before being sent to our API. Personal posts, direct messages,
                and general browsing history are never read or transmitted.
              </li>
            </ul>

            <p className="text-gov-slate text-base leading-relaxed mb-2 font-semibold">
              What is sent to https://askarthur.au/api/extension/*:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2 mb-4">
              <li>
                URL or text you explicitly submit via the popup or right-click
                menu
              </li>
              <li>Extension IDs when you run the Security Scanner</li>
              <li>
                Ad fingerprints (structural representations, not raw post
                contents) when Facebook scanning is active
              </li>
              <li>
                A per-install public key (ECDSA P-256) used to authenticate
                requests
              </li>
            </ul>

            <p className="text-gov-slate text-base leading-relaxed mb-2 font-semibold">
              What is not sent:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2 mb-4">
              <li>Personal posts, direct messages, private browsing history</li>
              <li>
                Full page contents outside the Facebook sponsored-post
                fingerprinting flow
              </li>
              <li>
                Any identifying information beyond the per-install public key
              </li>
            </ul>

            <p className="text-gov-slate text-base leading-relaxed mb-3">
              <strong>Authentication model.</strong> Each install generates an
              ECDSA P-256 keypair on first run. The private key is
              non-extractable and stored in the browser&apos;s local IndexedDB
              — it never leaves your device. All API requests are signed with
              the private key and verified server-side using the stored public
              key, with a short-lived nonce to prevent replay attacks.
            </p>

            <p className="text-gov-slate text-base leading-relaxed">
              <strong>Retention.</strong> Requests to the extension API are
              processed identically to web-app submissions — the analysed
              content is discarded after analysis; only aggregated,
              PII-scrubbed statistics are retained.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              5. Data Retention
            </h2>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2">
              <li>
                Submitted messages and images are discarded immediately after
                analysis.
              </li>
              <li>
                PII-scrubbed scam pattern data (verdict counts, region
                statistics) is retained indefinitely to improve the service.
              </li>
              <li>Rate limit keys auto-expire after 24 hours.</li>
              <li>
                Subscriber email addresses are stored until you unsubscribe.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              6. Cookies &amp; Tracking
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              Ask Arthur does not use cookies. We use Plausible Analytics, which
              is a privacy-first analytics platform that does not use cookies,
              does not collect personal data, and is fully compliant with GDPR,
              CCPA, and PECR.
            </p>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              7. Your Rights
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-3">
              Under the Privacy Act 1988 (Cth), you have the right to:
            </p>
            <ul className="list-disc list-inside text-gov-slate text-base leading-relaxed space-y-2">
              <li>
                Request access to any personal information we hold about you
              </li>
              <li>Request correction of inaccurate information</li>
              <li>
                Lodge a complaint with the Office of the Australian Information
                Commissioner (OAIC) at{" "}
                <a
                  href="https://www.oaic.gov.au"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-action-teal hover:underline"
                >
                  oaic.gov.au
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-deep-navy text-lg font-bold mb-3">
              8. Contact
            </h2>
            <p className="text-gov-slate text-base leading-relaxed">
              For privacy inquiries, contact us at{" "}
              <a
                href="mailto:brendan@askarthur.au"
                className="text-action-teal hover:underline"
              >
                brendan@askarthur.au
              </a>
            </p>
          </section>

          <section>
            <p className="text-sm text-slate-400">
              Last updated: April 2026
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
