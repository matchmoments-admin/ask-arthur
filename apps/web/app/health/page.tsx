import { Suspense } from "react";
import { ShieldCheck, Puzzle, Plug, Zap } from "lucide-react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import UniversalScanner from "@/components/UniversalScanner";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Security Scanner | Ask Arthur",
  description:
    "Free security scanner for websites, Chrome extensions, MCP servers, and AI skills. Get a safety grade in seconds with actionable recommendations.",
};

export default function ScannerPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Security Scanner
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Scan any website, Chrome extension, MCP server, or AI skill.
          Get a safety grade with actionable recommendations.
        </p>

        <Suspense>
          <UniversalScanner />
        </Suspense>

        {/* Feature grid */}
        <section className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 pb-16">
          <div className="text-center">
            <ShieldCheck className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              Websites
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Headers, TLS, CSP, email security, and more.
            </p>
          </div>
          <div className="text-center">
            <Puzzle className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              Extensions
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Permissions, AI targeting, request interception.
            </p>
          </div>
          <div className="text-center">
            <Plug className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              MCP Servers
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Tool poisoning, supply chain, secret exposure.
            </p>
          </div>
          <div className="text-center">
            <Zap className="text-deep-navy mb-3 mx-auto" size={28} />
            <h3 className="text-deep-navy font-bold text-xs uppercase tracking-widest mb-1">
              AI Skills
            </h3>
            <p className="text-gov-slate text-sm leading-relaxed">
              Prompt injection, malware, data exfiltration.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
