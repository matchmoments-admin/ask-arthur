import { Suspense } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import SiteAuditChecker from "@/components/SiteAuditChecker";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Website Safety Audit | Ask Arthur",
  description:
    "Free website security scanner. Check any URL for security headers, TLS configuration, mixed content, and more. Get a safety grade in seconds.",
};

export default function AuditPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Website Safety Audit
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Enter any website URL to scan its security configuration. Get a safety
          grade with actionable recommendations.
        </p>

        <Suspense>
          <SiteAuditChecker />
        </Suspense>

        {/* Feature grid */}
        <section className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center">
            <span className="material-symbols-outlined text-deep-navy text-4xl mb-3 block">
              security
            </span>
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">
              Headers & TLS
            </h3>
            <p className="text-gov-slate text-base leading-relaxed">
              Checks HSTS, CSP, X-Frame-Options, TLS versions, and SSL
              certificate validity.
            </p>
          </div>
          <div className="text-center">
            <span className="material-symbols-outlined text-deep-navy text-4xl mb-3 block">
              speed
            </span>
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">
              Instant Results
            </h3>
            <p className="text-gov-slate text-base leading-relaxed">
              Full scan completes in 2-5 seconds. No signup, no cost, no
              waiting.
            </p>
          </div>
          <div className="text-center">
            <span className="material-symbols-outlined text-deep-navy text-4xl mb-3 block">
              checklist
            </span>
            <h3 className="text-deep-navy font-bold text-sm uppercase tracking-widest mb-2">
              Actionable
            </h3>
            <p className="text-gov-slate text-base leading-relaxed">
              Get a letter grade plus specific recommendations to improve your
              site&apos;s security.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
