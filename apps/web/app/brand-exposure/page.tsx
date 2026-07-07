import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import BrandExposureChecker from "@/components/BrandExposureChecker";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const metadata: Metadata = {
  title: "Is your brand being cloned? | Ask Arthur Clone Watch",
  description:
    "Check how many lookalike and copycat domains Ask Arthur has detected impersonating your brand. Free exposure check for Australian brands, security and compliance teams.",
};

export const dynamic = "force-dynamic";

export default function BrandExposurePage() {
  // Dark until FF_BRAND_EXPOSURE is flipped (preview dogfood first).
  if (!featureFlags.brandExposure) {
    notFound();
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-5 py-14">
        <div className="mb-8 text-center">
          <p className="text-gov-slate mb-2 text-xs font-semibold uppercase tracking-wide">
            Clone Watch · Free exposure check
          </p>
          <h1 className="text-deep-navy text-3xl font-extrabold sm:text-4xl">
            Is your brand being cloned?
          </h1>
          <p className="text-gov-slate mx-auto mt-3 max-w-2xl text-base">
            Ask Arthur scans newly-registered domains every day for lookalikes
            impersonating Australian brands. Enter your brand to see how many
            we&apos;ve detected — then request the full list.
          </p>
        </div>

        <BrandExposureChecker />

        <p className="text-gov-slate mx-auto mt-10 max-w-2xl text-center text-xs">
          Detections are suspected lookalikes surfaced for review, not adjudicated
          rulings. We report confirmed clones to community blocklists and, for
          monitored brands, notify the brand&apos;s security team.
        </p>
      </main>
      <Footer />
    </>
  );
}
