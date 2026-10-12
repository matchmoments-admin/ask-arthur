import { Suspense } from "react";
import Link from "next/link";
import { ShieldCheck, ClipboardClock, Shield, Mail, Radar } from "lucide-react";
import ScamChecker from "@/components/ScamChecker";
import ScamCounter from "@/components/ScamCounter";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import { jsonLdScript } from "@/lib/json-ld";

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://askarthur.au/#organization",
      name: "Ask Arthur",
      url: "https://askarthur.au",
      logo: {
        "@type": "ImageObject",
        url: "https://askarthur.au/icon/128.png",
        width: 128,
        height: 128,
      },
      description:
        "Australia's AI-powered scam detection platform helping Australians identify fraudulent messages, emails, and images.",
      sameAs: [
        "https://www.linkedin.com/company/114874091",
      ],
      contactPoint: {
        "@type": "ContactPoint",
        email: "brendan@askarthur.au",
        contactType: "customer support",
        availableLanguage: "English",
        areaServed: "AU",
      },
      address: {
        "@type": "PostalAddress",
        addressCountry: "AU",
      },
    },
    {
      "@type": "WebSite",
      "@id": "https://askarthur.au/#website",
      url: "https://askarthur.au",
      name: "Ask Arthur",
      description: "Australia's AI-powered scam detection platform",
      publisher: { "@id": "https://askarthur.au/#organization" },
      inLanguage: "en-AU",
    },
    {
      "@type": "SoftwareApplication",
      name: "Ask Arthur",
      url: "https://askarthur.au",
      applicationCategory: "SecurityApplication",
      operatingSystem: "Web, iOS, Android",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "AUD",
      },
      description:
        "AI-powered scam detection for Australians. Check messages, links, phone numbers and images instantly.",
      publisher: { "@id": "https://askarthur.au/#organization" },
    },
  ],
};

// Clone-Watch-only mode (docs/ops/clone-watch-only-mode.md). Literal
// NEXT_PUBLIC_ access on purpose: this page is statically rendered, so the
// value is inlined at build — flipping it needs a redeploy, like every
// NEXT_PUBLIC_ flag.
const CLONE_WATCH_ONLY = process.env.NEXT_PUBLIC_FF_CLONE_WATCH_ONLY === "true";

function CloneWatchHome() {
  return (
    <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
      />
      <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-6 leading-tight text-center">
        Lookalike domains, caught before they phish
      </h1>
      <p className="text-gov-slate text-lg leading-relaxed text-center max-w-[52ch] mx-auto mb-10">
        Clone Watch scans every newly registered domain for names that
        impersonate Australian brands, then tracks which ones turn into live
        phishing sites.
      </p>
      <section
        aria-labelledby="clone-watch-cta"
        className="rounded-2xl border border-deep-navy/15 bg-deep-navy/[0.03] p-7 text-center"
      >
        <Radar className="text-deep-navy mb-3 mx-auto" size={32} />
        <h2
          id="clone-watch-cta"
          className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-4"
        >
          Clone Watch
        </h2>
        <Link
          href="/clone-watch"
          className="inline-block py-3 px-8 bg-deep-navy text-white font-bold uppercase tracking-widest rounded-[4px] hover:bg-navy transition-colors"
        >
          See the latest lookalikes
        </Link>
        <p className="text-gov-slate text-sm leading-relaxed mt-5">
          The consumer scam checker is paused.{" "}
          <Link href="/blog" className="font-semibold text-deep-navy underline underline-offset-2">
            Read the blog
          </Link>
          .
        </p>
      </section>
    </main>
  );
}

export default function Home() {
  if (CLONE_WATCH_ONLY) {
    return (
      <div className="min-h-screen flex flex-col">
        <Nav />
        <CloneWatchHome />
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      {/* Hero / Main content */}
      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(jsonLd) }}
        />
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-10 leading-tight text-center">
          Suspicious message, email or image? Just Ask Arthur
        </h1>

        <Suspense>
          <ScamChecker />
        </Suspense>
        <ScamCounter />

        {/* Feature grid */}
        <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <ShieldCheck className="text-deep-navy mb-3 mx-auto" size={36} />
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">Authority</h3>
            <p className="text-gov-slate text-base leading-relaxed">
              Powered by advanced AI trained on thousands of real scam patterns and fraud databases.
            </p>
          </div>
          <div className="text-center">
            <ClipboardClock className="text-deep-navy mb-3 mx-auto" size={36} />
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">Efficiency</h3>
            <p className="text-gov-slate text-base leading-relaxed">
              Get a detailed verdict in seconds. No signup, no waiting, no cost.
            </p>
          </div>
          <div className="text-center">
            <Shield className="text-deep-navy mb-3 mx-auto" size={36} />
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">Privacy</h3>
            <p className="text-gov-slate text-base leading-relaxed">
              Your messages are never stored. Analyzed and immediately discarded.
            </p>
          </div>
        </section>

        {/* Email forwarding entry point — activation lever 2 (#909).
            The address is a public distribution group on askarthur.au that
            relays to the Cloudflare inbound pipeline; verdict replies thread
            under the forwarded email. */}
        <section
          aria-labelledby="forward-heading"
          className="mt-16 rounded-2xl border border-deep-navy/15 bg-deep-navy/[0.03] p-7 text-center"
        >
          <Mail className="text-deep-navy mb-3 mx-auto" size={32} />
          <h2
            id="forward-heading"
            className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2"
          >
            Or just forward it
          </h2>
          <p className="text-gov-slate text-base leading-relaxed max-w-[46ch] mx-auto">
            Forward any suspicious email to{" "}
            <a
              href="mailto:scan@askarthur.au"
              className="font-semibold text-deep-navy underline underline-offset-2"
            >
              scan@askarthur.au
            </a>{" "}
            and Arthur replies with a verdict in the same thread — usually
            within a minute. Free, no signup, three checks a day.
          </p>
        </section>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
