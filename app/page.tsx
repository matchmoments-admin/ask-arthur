import Link from "next/link";
import ScamChecker from "@/components/ScamChecker";
import ScamCounter from "@/components/ScamCounter";
import WaitlistForm from "@/components/WaitlistForm";
import Footer from "@/components/Footer";

export default function Home() {
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

      {/* Hero / Main content */}
      <main className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Got a suspicious message?
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Paste it here. We&apos;ll tell you if it&apos;s a scam — and exactly why.
        </p>

        <ScamChecker />
        <ScamCounter />

        {/* Feature grid */}
        <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <span className="material-symbols-outlined text-deep-navy text-4xl mb-3 block">verified_user</span>
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">Authority</h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Powered by advanced AI trained on thousands of real scam patterns and fraud databases.
            </p>
          </div>
          <div className="text-center">
            <span className="material-symbols-outlined text-deep-navy text-4xl mb-3 block">bolt</span>
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">Efficiency</h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Get a detailed verdict in seconds. No signup, no waiting, no cost.
            </p>
          </div>
          <div className="text-center">
            <span className="material-symbols-outlined text-deep-navy text-4xl mb-3 block">shield</span>
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">Privacy</h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Your messages are never stored. Analyzed and immediately discarded.
            </p>
          </div>
        </section>
      </main>

      {/* Waitlist section */}
      <WaitlistForm />

      {/* Footer */}
      <Footer />
    </div>
  );
}
