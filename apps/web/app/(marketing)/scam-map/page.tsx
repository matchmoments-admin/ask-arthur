import type { Metadata } from "next";
import WorldScamMapWithHighlights from "@/components/charts/WorldScamMapWithHighlights";
import { getWorldStats } from "@/lib/dashboard/public-stats";
import { OG_BASE } from "@/lib/og";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Global Scam Map",
  description:
    "See where scams are being reported around the world. Live data from the Ask Arthur community and 14+ threat intelligence feeds.",
  alternates: { canonical: "https://askarthur.au/scam-map" },
  openGraph: {
      // Next replaces the parent openGraph wholesale — every key not named
      // here is dropped. Spread the base first. See lib/og.ts.
      ...OG_BASE,
    title: "Global Scam Map — Ask Arthur",
    description:
      "See where scams are being reported around the world. Live scam intelligence data.",
    url: "https://askarthur.au/scam-map",
  },
};

export default async function ScamMapPage() {
  const countryData = await getWorldStats();

  return (
    // Shell from app/(marketing)/layout.tsx. max-w-3xl is this page's
    // documented exception in DESIGN_SYSTEM.md, which is why width stays local.
    <div className="max-w-3xl mx-auto">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Global Scam Map
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Live scam reports from 190+ countries, sourced from our Feed. Click
          any country to open it filtered to that location.
        </p>
        <WorldScamMapWithHighlights countryData={countryData} />
    </div>
  );
}
