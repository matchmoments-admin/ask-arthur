import Link from "next/link";
import { gateOrNotFound } from "@/lib/featureGate";
import DocumentCheckClient from "./DocumentCheckClient";

// Public document checker — the consumer surface of the Document Check
// Module. Deterministic PDF structural forensics (revision history, producer
// tells, metadata dates) — no classifier, no paid APIs, nothing stored.
// Sibling page to /image-check; findings copy comes from
// DOCUMENT_CHECK_COPY (asymmetry-guarded by documentCheckCopy.test.ts).

// Required: featureGate helpers evaluate at build time on static routes
// (see apps/web/lib/featureGate.ts + featureGateRuntime.test.ts).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Document Check — Ask Arthur",
  description:
    "Check a PDF — an invoice, payslip, bank letter or rental document — for editing traces: revision history, the tool that made it, and metadata timestamps. Free, no sign-up, nothing stored.",
};

export default function DocumentCheckPage() {
  gateOrNotFound("documentCheck");

  return (
    <main className="min-h-screen bg-[#fbfbfa] px-4 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Ask Arthur — Document Check
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-gray-900">
            Has this document been edited?
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Upload a PDF — an invoice, payslip, bank letter or rental document —
            and we&rsquo;ll read the editing traces stored inside the file:
            whether it was re-saved after creation, what software produced it,
            and whether its timestamps line up. Checked in memory, never stored.
          </p>
        </header>

        <DocumentCheckClient />

        <footer className="space-y-2 text-xs text-gray-500">
          <p>
            Got the document as a message, email or link instead?{" "}
            <Link href="/" className="underline">
              Run it through the main scam checker
            </Link>
            {" "}— or check{" "}
            <Link href="/image-check" className="underline">
              an image
            </Link>{" "}
            for AI-generation signals.
          </p>
        </footer>
      </div>
    </main>
  );
}
