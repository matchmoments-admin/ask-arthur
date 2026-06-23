import type { Metadata } from "next";
import { ShieldCheck, Search, ScanSearch, UserCheck, Rss, Database } from "lucide-react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import ChartsSection from "@/components/charts/ChartsSection";
import WorldScamMapWithHighlights from "@/components/charts/WorldScamMapWithHighlights";
import { getChartData, getWorldStats } from "@/lib/dashboard/public-stats";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "About Ask Arthur — A quiet second opinion on scams",
  description:
    "Ask Arthur helps Australians pause before they click, transfer, or sign in. A suite of tools — scam checker, security scanner, persona check, feed — built around a simple idea: asking is protective.",
  openGraph: {
    title: "About Ask Arthur",
    description:
      "Ask Arthur is the pause — a calm second opinion before you click, transfer, or sign in.",
    url: "https://askarthur.au/about",
  },
  alternates: { canonical: "https://askarthur.au/about" },
};

const aboutJsonLd = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About Ask Arthur",
  url: "https://askarthur.au/about",
  description: "Australia's AI-powered scam detection platform",
  mainEntity: { "@id": "https://askarthur.au/#organization" },
};

const partners = [
  { name: "ACCC Scamwatch", url: "https://www.scamwatch.gov.au" },
  { name: "IDCARE", url: "https://www.idcare.org" },
  { name: "ASD ACSC", url: "https://www.cyber.gov.au" },
  { name: "GASA", url: "https://www.gasa.org" },
];

const tools = [
  {
    icon: Search,
    name: "Scam Checker",
    href: "/",
    desc: "Paste a message, link, or screenshot. Get a plain-English verdict in seconds.",
  },
  {
    icon: ScanSearch,
    name: "Security Scanner",
    href: "/health",
    desc: "Grade any website, Chrome extension, MCP server, or AI skill A+ to F.",
  },
  {
    icon: UserCheck,
    name: "Persona Check",
    href: "/persona-check",
    desc: "Check if someone online is who they claim to be — romance, recruiting, and identity fraud.",
  },
  {
    icon: Rss,
    name: "Feed",
    href: "/scam-feed",
    desc: "A daily, location-aware feed of the scams doing the rounds right now in Australia.",
  },
  {
    icon: Database,
    name: "Intelligence API",
    href: "/api-docs",
    desc: "For organisations: real-time threat intelligence linking companies to the domains impersonating them.",
  },
];

export default async function AboutPage() {
  const [chartData, worldData] = await Promise.all([
    getChartData(),
    getWorldStats(),
  ]);
  const { safeCount, suspiciousCount, highRiskCount, stateData } = chartData;

  const totalChecks = safeCount + suspiciousCount + highRiskCount;
  const hasData = totalChecks > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(aboutJsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-16">
        <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-4 leading-tight text-center">
          About Ask Arthur
        </h1>
        <p className="text-lg text-gov-slate mb-16 leading-relaxed text-center">
          A quiet second opinion when something doesn&apos;t quite feel right —
          before you click, transfer, or sign in.
        </p>

        <section className="mb-20">
          <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-8 text-center">
            Why we build Ask Arthur
          </h2>

          <div className="space-y-5 text-base md:text-lg text-gov-slate leading-relaxed italic">
            <p>
              Scams work by rushing you. Act now, click before it&apos;s gone,
              pay before the fine doubles. When you&apos;re rushing, you&apos;re
              not thinking.
            </p>

            <p>
              <strong className="not-italic font-semibold text-deep-navy">
                Ask Arthur is the pause.
              </strong>{" "}
              Take a breath and get a second opinion before you click,
              transfer, or sign in. Paste the message in and see what Arthur
              thinks. When Arthur isn&apos;t sure, Arthur says so.
            </p>

            <p>
              Being scammed is never your fault. Scammers are skilled
              professionals, and anyone with a phone is a target.
            </p>

            <p>
              If something doesn&apos;t feel right, just ask Arthur. We&apos;ll
              take a look together.
            </p>
          </div>

          <p className="mt-8 text-sm text-gov-slate not-italic">
            — Brendan
          </p>
        </section>

        <section className="mb-20">
          <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-3 text-center">
            A suite of tools, one idea
          </h2>
          <p className="text-gov-slate text-center mb-10 leading-relaxed">
            Every tool is built around the same pause — give people a moment
            to check before they act.
          </p>

          <div className="space-y-3">
            {tools.map(({ icon: Icon, name, href, desc }) => (
              <a
                key={name}
                href={href}
                className="block p-4 bg-white border border-border-light rounded-xl hover:border-action-teal/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-4">
                  <Icon size={22} className="text-action-teal shrink-0 mt-1" />
                  <div>
                    <p className="font-semibold text-deep-navy">{name}</p>
                    <p className="text-sm text-gov-slate mt-1 leading-relaxed">
                      {desc}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="mb-20">
          <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-3 text-center">
            Reporting helps the next person
          </h2>
          <p className="text-gov-slate leading-relaxed text-center">
            Every scam you flag helps the next person spot the same trick. You
            don&apos;t have to have been fooled to help — asking is enough.
          </p>
        </section>

        {hasData && (
          <section className="mb-20">
            <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-3 text-center">
              Australian scam insights
            </h2>
            <p className="text-gov-slate text-center mb-8 leading-relaxed">
              A snapshot of how Australians are using Ask Arthur to stay safe.
            </p>
            <ChartsSection
              safeCount={safeCount}
              suspiciousCount={suspiciousCount}
              highRiskCount={highRiskCount}
              stateData={stateData}
            />
          </section>
        )}

        <section className="mb-20">
          <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-3 text-center">
            Scams around the world
          </h2>
          <p className="text-gov-slate text-center mb-8 leading-relaxed">
            Live scam reports from 190+ countries, sourced from our Feed.
            Click any country to open it filtered to that location.
          </p>
          <WorldScamMapWithHighlights countryData={worldData} />
        </section>

        <section>
          <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-3 text-center">
            Aligned with Australia&apos;s authorities
          </h2>
          <p className="text-gov-slate text-center mb-8 leading-relaxed">
            Our threat intelligence references official Australian and
            international scam-fighting bodies.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {partners.map(({ name, url }) => (
              <a
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border-light bg-white text-sm font-medium text-gov-slate hover:border-action-teal/40 hover:text-deep-navy transition-colors"
              >
                <ShieldCheck size={13} className="text-action-teal" />
                {name}
              </a>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
