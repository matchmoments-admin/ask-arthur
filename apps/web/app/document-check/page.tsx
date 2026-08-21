import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import Link from "next/link";
import { gateOrNotFound } from "@/lib/featureGate";
import DocumentCheckClient from "./DocumentCheckClient";

// Public document checker — the consumer surface of the Document Check
// Module. Deterministic PDF structural forensics (revision history, producer
// tells, metadata dates) + the AU content pack (ABN checks) — no classifier,
// no paid APIs, nothing stored. Marketing page shell per DESIGN_SYSTEM.md
// (canonical: /persona-check); findings copy from DOCUMENT_CHECK_COPY
// (asymmetry-guarded by documentCheckCopy.test.ts).

// Required: featureGate helpers evaluate at build time on static routes
// (see apps/web/lib/featureGate.ts + featureGateRuntime.test.ts).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Document Check — Has This PDF Been Edited? | Ask Arthur",
  description:
    "Check a PDF — an invoice, payslip, bank letter or rental document — for editing traces: revision history, the tool that made it, and whether its ABN is real. Free, no sign-up, nothing stored.",
};

export default function DocumentCheckPage() {
  gateOrNotFound("documentCheck");

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main
        id="main-content"
        className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16"
      >
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Has this document been edited?
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Upload a PDF — an invoice, payslip, bank letter or rental document —
          and Arthur will read the editing traces stored inside the file and
          check any ABN it displays. Checked in memory, never stored.
        </p>

        <DocumentCheckClient />

        <p className="mt-10 text-sm text-gov-slate text-center leading-relaxed">
          Got the document as a message, email or link instead?{" "}
          <Link href="/" className="text-deep-navy underline">
            Run it through the main scam checker
          </Link>{" "}
          — or check{" "}
          <Link href="/image-check" className="text-deep-navy underline">
            an image
          </Link>{" "}
          for AI-generation signals.
        </p>
      </main>
      <Footer />
    </div>
  );
}
