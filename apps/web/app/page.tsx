import { Suspense } from "react";
import { ShieldCheck, ClipboardClock, Shield } from "lucide-react";
import ScamChecker from "@/components/ScamChecker";
import ScamCounter from "@/components/ScamCounter";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

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
        "https://www.linkedin.com/company/askarthur",
      ],
      contactPoint: {
        "@type": "ContactPoint",
        email: "hello@askarthur.au",
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

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      {/* Hero / Main content */}
      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Got a suspicious message, email, or image?
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Paste it here. Arthur will review it and report back to you.
        </p>

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
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
