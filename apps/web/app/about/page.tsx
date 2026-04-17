import type { Metadata } from "next";
import { ShieldCheck, Search, ScanSearch, UserCheck, Rss, Database } from "lucide-react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import ChartsSection from "@/components/charts/ChartsSection";
import WorldScamMap from "@/components/charts/WorldScamMap";
import { createServiceClient } from "@askarthur/supabase/server";
import { parseStateFromRegion } from "@/lib/chart-tokens";

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

interface StatsRow {
  safe_count: number;
  suspicious_count: number;
  high_risk_count: number;
  region: string | null;
}

async function getChartData() {
  const supabase = createServiceClient();
  if (!supabase) {
    return { safeCount: 0, suspiciousCount: 0, highRiskCount: 0, stateData: {} };
  }

  const { data, error } = await supabase
    .from("check_stats")
    .select("safe_count, suspicious_count, high_risk_count, region");

  if (error || !data) {
    return { safeCount: 0, suspiciousCount: 0, highRiskCount: 0, stateData: {} };
  }

  let safeCount = 0;
  let suspiciousCount = 0;
  let highRiskCount = 0;
  const stateData: Record<string, number> = {};

  for (const row of data as StatsRow[]) {
    safeCount += row.safe_count ?? 0;
    suspiciousCount += row.suspicious_count ?? 0;
    highRiskCount += row.high_risk_count ?? 0;

    if (row.region) {
      const stateCode = parseStateFromRegion(row.region);
      if (stateCode) {
        const rowTotal =
          (row.safe_count ?? 0) +
          (row.suspicious_count ?? 0) +
          (row.high_risk_count ?? 0);
        stateData[stateCode] = (stateData[stateCode] ?? 0) + rowTotal;
      }
    }
  }

  return { safeCount, suspiciousCount, highRiskCount, stateData };
}

async function getWorldStats(): Promise<Record<string, number>> {
  const supabase = createServiceClient();
  if (!supabase) return {};

  const { data, error } = await supabase.rpc("get_world_scam_stats", {
    days_back: 30,
  });

  if (error || !data) return {};

  const map: Record<string, number> = {};
  for (const row of data as Array<{ country_code: string; scam_count: number }>) {
    map[row.country_code] = row.scam_count;
  }
  return map;
}

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
            A note from the founder
          </h2>

          <div className="space-y-5 text-base md:text-lg text-gov-slate leading-relaxed italic">
            <p>
              Every scam story I&apos;ve heard shares one thing: urgency. A
              message that tells you to act now. A phone call that won&apos;t
              let you hang up. A link you must click before the
              &ldquo;offer&rdquo; disappears, the &ldquo;account&rdquo; closes,
              or the &ldquo;fine&rdquo; doubles. Urgency is the scammer&apos;s
              most reliable tool, because a person who&apos;s rushing is a
              person who isn&apos;t thinking.
            </p>

            <p>
              <strong className="not-italic font-semibold text-deep-navy">
                Ask Arthur is the pause.
              </strong>{" "}
              It&apos;s the moment you step back, take a breath, and get a
              second opinion before you click, transfer, or sign in. Paste the
              message in, read what Arthur has to say, and give yourself time
              to think. When Arthur isn&apos;t sure, Arthur will say so — and
              always err on the side of caution. That caution is the whole
              point.
            </p>

            <p>
              Everyone deserves that pause. Not just the tech-savvy, not just
              people with a family member who works in cyber, and not just
              those who already know the tricks. Anyone with a phone and a
              bank account is a target now, every single day. Being scammed is
              never your fault — scammers are skilled professionals who
              deceive people of every age.
            </p>

            <p>
              The act of asking is itself protective. When you stop to check,
              you break the spell the scammer is relying on. And you&apos;re
              not just protecting yourself — every scam you report helps
              someone further behind you on the same path. Maybe you
              weren&apos;t fooled, but reporting it might save someone who
              would have been.
            </p>

            <p>
              If something doesn&apos;t feel right or doesn&apos;t quite add up
              — just ask Arthur. We&apos;ll take a look together.
            </p>
          </div>

          <p className="mt-8 text-sm text-gov-slate not-italic">
            — Brendan Milton, Founder
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
            Scams evolve daily. Our Feed pulls signals from Reddit, public
            reports, and our own users to surface what&apos;s active right
            now — so the next person who sees the same message already has the
            answer. Every check you run, every scam you flag, strengthens the
            pause for someone behind you. You don&apos;t have to have been
            fooled to help. Asking is enough.
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
          <WorldScamMap countryData={worldData} />
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
