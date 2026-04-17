import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Chrome Extension — Ask Arthur | AI Scam Detection for Facebook",
  description:
    "Free Chrome extension that detects scam ads on Facebook, scores Marketplace sellers, catches PayID scam patterns, and scans extensions for security risks.",
  openGraph: {
    title: "Ask Arthur Chrome Extension",
    description:
      "Detect scam ads and dodgy sellers on Facebook. Free, no account required.",
    images: ["/illustrations/extension-launch.webp"],
  },
};

const FEATURES = [
  {
    title: "Scam ad detection",
    description:
      "Warning banners appear directly on suspicious sponsored posts in your Facebook feed.",
  },
  {
    title: "Marketplace seller scoring",
    description:
      "Trust badges on listing pages based on account age, ratings, and location.",
  },
  {
    title: "PayID scam warnings",
    description:
      "Detects PayID scam patterns in Messenger conversations and warns you in real time.",
  },
  {
    title: "URL checking",
    description:
      "Paste any URL to check it against Google Safe Browsing and community reports.",
  },
  {
    title: "Message analysis",
    description:
      "Paste suspicious emails, texts, or messages for AI-powered scam detection.",
  },
  {
    title: "Extension security scanner",
    description:
      "Audit your installed Chrome extensions for security risks, graded A+ to F.",
  },
  {
    title: "Deepfake image detection",
    description:
      "Identifies AI-generated celebrity endorsement images in scam ads.",
  },
  {
    title: "Community flagging",
    description:
      "Flag scam ads to protect other Australians. 3+ flags triggers instant warnings.",
  },
];

export default function ExtensionPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-16">
      {/* Hero */}
      <section className="text-center mb-16">
        <div className="mb-8">
          <Image
            src="/illustrations/extension-launch.webp"
            alt="Person protected from scam ads by Ask Arthur"
            width={800}
            height={600}
            className="rounded-2xl mx-auto"
            priority
          />
        </div>
        <h1 className="text-4xl font-bold text-deep-navy mb-4">
          Detect scam ads and dodgy sellers on Facebook
        </h1>
        <p className="text-lg text-gov-slate max-w-2xl mx-auto mb-8">
          Free Chrome extension that spots scam ads in your feed, scores
          Marketplace sellers, and catches PayID tricks in Messenger. No account
          needed.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="#install"
            className="inline-flex items-center justify-center h-12 px-8 bg-deep-navy text-white font-semibold rounded-full hover:bg-navy transition-colors text-base"
          >
            Install for Chrome — Free
          </a>
          <Link
            href="/blog/chrome-extension-launch"
            className="inline-flex items-center justify-center h-12 px-8 bg-white text-deep-navy font-semibold rounded-full border-2 border-deep-navy hover:bg-surface transition-colors text-base"
          >
            Read the launch post
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold text-deep-navy mb-8 text-center">
          What it does
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-surface rounded-xl p-6 border border-border-default"
            >
              <h3 className="font-semibold text-deep-navy mb-2">{f.title}</h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works on Facebook */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold text-deep-navy mb-6 text-center">
          How it protects you on Facebook
        </h2>
        <div className="space-y-6">
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-red-600 font-bold text-lg">1</span>
            </div>
            <div>
              <h3 className="font-semibold text-deep-navy mb-1">
                Sponsored posts
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                When you scroll your feed, Ask Arthur quietly checks every
                sponsored post. If it finds something suspicious, you see a
                warning banner right on the ad — before you click.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-amber-600 font-bold text-lg">2</span>
            </div>
            <div>
              <h3 className="font-semibold text-deep-navy mb-1">
                Marketplace listings
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                When you open a listing, Ask Arthur checks the seller&apos;s
                account age, ratings, and location. You see a trust badge
                (green, amber, or red) so you know what you&apos;re dealing with.
              </p>
            </div>
          </div>
          <div className="flex gap-4 items-start">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 mt-1">
              <span className="text-blue-600 font-bold text-lg">3</span>
            </div>
            <div>
              <h3 className="font-semibold text-deep-navy mb-1">
                Messenger chats
              </h3>
              <p className="text-gov-slate text-sm leading-relaxed">
                If a buyer or seller starts using PayID scam tactics — fake
                payment screenshots, requests to &ldquo;verify&rdquo; your bank
                details — Ask Arthur shows a warning in the chat.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy */}
      <section className="mb-16 bg-surface rounded-2xl p-8 border border-border-default">
        <h2 className="text-2xl font-bold text-deep-navy mb-4 text-center">
          Your privacy is protected
        </h2>
        <div className="grid sm:grid-cols-2 gap-4 max-w-xl mx-auto">
          {[
            "No account required",
            "No data stored",
            "No browsing history tracked",
            "No data sold — ever",
            "Free to use",
            "Zero-knowledge architecture",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <span className="text-green-700 text-xs font-bold">&#10003;</span>
              </div>
              <span className="text-gov-slate text-sm">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Install CTA */}
      <section id="install" className="text-center mb-16">
        <h2 className="text-2xl font-bold text-deep-navy mb-4">
          Get protected in 30 seconds
        </h2>
        <p className="text-gov-slate mb-6">
          Works on Chrome, Edge, Brave, and any Chromium browser.
        </p>
        {process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL ? (
          <a
            href={process.env.NEXT_PUBLIC_CHROME_WEB_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center h-14 px-10 bg-deep-navy text-white font-semibold rounded-full hover:bg-navy transition-colors text-lg"
          >
            Add to Chrome — It&apos;s Free
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="inline-flex items-center justify-center h-14 px-10 bg-slate-300 text-slate-600 font-semibold rounded-full text-lg cursor-not-allowed"
          >
            Launching soon — check back shortly
          </span>
        )}
        <p className="text-xs text-slate-400 mt-3">
          No signup. No credit card. Free to use every day.
        </p>
      </section>

      {/* Blog link */}
      <section className="text-center border-t border-border-default pt-8">
        <p className="text-gov-slate text-sm">
          Want the full story?{" "}
          <Link
            href="/blog/chrome-extension-launch"
            className="text-action-teal-text hover:underline font-medium"
          >
            Read our launch blog post
          </Link>
        </p>
      </section>
    </main>
  );
}
