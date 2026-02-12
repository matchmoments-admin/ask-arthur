import Link from "next/link";
import SubscribeForm from "@/components/SubscribeForm";
import Footer from "@/components/Footer";

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <div className="h-1.5 bg-deep-navy w-full" />

      {/* Nav */}
      <nav className="w-full max-w-[640px] mx-auto px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <Link href="/" className="text-deep-navy font-extrabold text-lg uppercase tracking-wide">
          Ask Arthur
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/blog" className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors">
            Blog
          </Link>
          <Link href="/about" className="text-deep-navy font-bold text-sm hover:text-action-teal transition-colors">
            About
          </Link>
        </div>
      </nav>

      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        <h1 className="text-deep-navy text-3xl font-extrabold mb-8">About Ask Arthur</h1>

        {/* Personal story */}
        <section className="mb-12">
          <p className="text-gov-slate text-base leading-relaxed mb-4">
            Scams are getting smarter. AI-generated phishing emails, fake texts from
            &quot;your bank,&quot; romance scams that play out over weeks — they&apos;re designed
            to trick even savvy people. And for older adults, the consequences can be
            devastating.
          </p>
          <p className="text-gov-slate text-base leading-relaxed">
            We built Ask Arthur because everyone deserves a quick, free way to check
            if something is a scam — without needing to be a cybersecurity expert.
            Just paste the message and get a clear, honest answer.
          </p>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="mb-12">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-6">How It Works</h2>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-deep-navy/10 text-deep-navy flex items-center justify-center font-semibold text-sm">
                1
              </div>
              <div>
                <h3 className="text-deep-navy font-semibold mb-1">Paste or upload</h3>
                <p className="text-gov-slate text-base leading-relaxed">
                  Copy the suspicious message, email, or URL into the checker.
                  You can also upload a screenshot of a text message or social media post.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-deep-navy/10 text-deep-navy flex items-center justify-center font-semibold text-sm">
                2
              </div>
              <div>
                <h3 className="text-deep-navy font-semibold mb-1">AI analyzes it</h3>
                <p className="text-gov-slate text-base leading-relaxed">
                  Our AI checks for known scam patterns, urgency tactics, suspicious
                  URLs, brand impersonation, and other red flags — in seconds.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-deep-navy/10 text-deep-navy flex items-center justify-center font-semibold text-sm">
                3
              </div>
              <div>
                <h3 className="text-deep-navy font-semibold mb-1">Get a clear verdict</h3>
                <p className="text-gov-slate text-base leading-relaxed">
                  You&apos;ll see a clear Safe, Suspicious, or High Risk verdict with
                  a plain-language explanation of what we found and what to do next.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section id="privacy" className="mb-12">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-4">Our Privacy Commitment</h2>
          <ul className="space-y-3">
            {[
              "We never store the messages you check. They're analyzed and immediately discarded.",
              "We never store your IP address or create user profiles.",
              "We don't use cookies or third-party trackers.",
              "Analytics are privacy-first (Plausible — no personal data collected).",
              "When scam patterns are saved for research, all personal information is scrubbed first.",
              "This tool is free and requires no signup.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gov-slate text-base leading-relaxed">
                <svg className="w-5 h-5 text-deep-navy flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Subscribe */}
        <SubscribeForm />
      </main>

      <Footer />
    </div>
  );
}
