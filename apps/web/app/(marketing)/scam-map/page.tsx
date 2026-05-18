import type { Metadata } from "next";
import WorldScamMapWithHighlights from "@/components/charts/WorldScamMapWithHighlights";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { getWorldStats } from "@/lib/dashboard/public-stats";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Global Scam Map",
  description:
    "See where scams are being reported around the world. Live data from the Ask Arthur community and 14+ threat intelligence feeds.",
  alternates: { canonical: "https://askarthur.au/scam-map" },
  openGraph: {
    title: "Global Scam Map — Ask Arthur",
    description:
      "See where scams are being reported around the world. Live scam intelligence data.",
    url: "https://askarthur.au/scam-map",
  },
};

export default async function ScamMapPage() {
  const countryData = await getWorldStats();

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full max-w-3xl mx-auto px-5 pt-16 pb-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          Global Scam Map
        </h1>
        <p className="text-lg text-gov-slate mb-10 leading-relaxed text-center">
          Live scam reports from 190+ countries, sourced from our Feed. Click
          any country to open it filtered to that location.
        </p>
        <WorldScamMapWithHighlights countryData={countryData} />
      </main>
      <Footer />
    </div>
  );
}
