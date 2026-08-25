import Link from "next/link";
import { gateOrNotFound } from "@/lib/featureGate";
import ImageCheckClient from "./ImageCheckClient";

// Public AI image checker — the web surface of the Image Check Module
// (extension right-click check shares the same engine). Deterministic
// AI-origin ladder (Content Credentials + metadata tags) plus the Hive
// classifier for URL checks.

// Required: featureGate helpers evaluate at build time on static routes
// (see apps/web/lib/featureGate.ts + featureGateRuntime.test.ts).
export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI Image Check — Ask Arthur",
  description:
    "Check an image for AI-generation signals and Content Credentials (C2PA) provenance. Free, no sign-up. Remember: no provenance data is normal — most platforms strip it.",
};

export default function ImageCheckPage() {
  gateOrNotFound("imageCheck");

  return (
    <main className="min-h-screen bg-[#fbfbfa] px-4 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <header>
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Ask Arthur — AI Image Check
          </p>
          <h1 className="mt-1 text-3xl font-semibold text-gray-900">
            Was this image made with AI?
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Paste an image link for an AI-generation and deepfake check, or
            upload a file to read its provenance data — Content Credentials
            (C2PA) and AI-origin metadata tags.
          </p>
        </header>

        <ImageCheckClient />

        <section className="rounded-xl border border-gray-200 bg-white p-6 space-y-3 text-sm text-gray-700">
          <h2 className="text-sm font-semibold text-gray-900">
            How to read the result
          </h2>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <span className="font-medium">Verified Content Credentials</span>{" "}
              are cryptographically signed — the strongest signal an image
              records its own AI origin.
            </li>
            <li>
              <span className="font-medium">Metadata tags</span> claiming AI
              origin can be edited by anyone — treat them as a hint.
            </li>
            <li>
              <span className="font-medium">Finding nothing proves nothing.</span>{" "}
              Most social platforms strip provenance data on upload, so a
              clean result never means an image is human-made — and detector
              scores are probabilities, not verdicts.
            </li>
          </ul>
          <p className="text-xs text-gray-500">
            Worried the image is part of a scam — a fake celebrity endorsement,
            an investment pitch, a too-good marketplace listing?{" "}
            <Link href="/" className="underline">
              Run the full scam check
            </Link>{" "}
            on the message or page it came from.
          </p>
        </section>
      </div>
    </main>
  );
}
