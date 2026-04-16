import type { Metadata } from "next";
import { ShieldCheck, Search, Zap, CheckCircle } from "lucide-react";
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
    "Ask Arthur is the pause. Paste a message, link, or screenshot and get a calm second opinion before you click, transfer, or sign in.",
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

      <main id="main-content" className="flex-1">
        {/* Quiet intro */}
        <section className="bg-white border-b border-border-light">
          <div className="max-w-3xl mx-auto px-5 py-12 md:py-16">
            <p className="text-lg md:text-xl text-gov-slate leading-relaxed">
              Ask Arthur helps Australians stop and check before they click,
              transfer, or sign in — a quiet second opinion when something
              doesn&apos;t quite feel right.
            </p>
          </div>
        </section>

        {/* A note from the founder */}
        <section className="bg-slate-50 border-b border-border-light">
          <div className="max-w-prose mx-auto px-5 py-16 md:py-20">
            <h2 className="text-deep-navy text-2xl md:text-3xl font-extrabold mb-8">
              A note from the founder
            </h2>

            <div className="space-y-6 text-base md:text-lg text-gov-slate leading-relaxed">
              <p>
                Every scam story I&apos;ve heard shares one thing: urgency. A
                message that tells you to act now. A phone call that won&apos;t
                let you hang up. A link you must click before the
                &ldquo;offer&rdquo; disappears, the &ldquo;account&rdquo;
                closes, or the &ldquo;fine&rdquo; doubles. Urgency is the
                scammer&apos;s most reliable tool, because a person who&apos;s
                rushing is a person who isn&apos;t thinking.
              </p>

              <p className="text-xl md:text-2xl font-semibold text-deep-navy py-2">
                Ask Arthur is the pause.
              </p>

              <p>
                It&apos;s the moment you step back, take a breath, and get a
                second opinion before you click, transfer, or sign in. Paste
                the message in, read what Arthur has to say, and give yourself
                time to think. When Arthur isn&apos;t sure, Arthur will say so
                — and always err on the side of caution. That caution is the
                whole point.
              </p>

              <p>
                Everyone deserves that pause. Not just the tech-savvy, not just
                people with a family member who works in cyber, and not just
                those who already know the tricks. Anyone with a phone and a
                bank account is a target now, every single day. Being scammed
                is never your fault — scammers are skilled professionals who
                deceive people of every age.
              </p>

              <p>
                The act of asking is itself protective. When you stop to check,
                you break the spell the scammer is relying on. You can always
                take time to check with someone you trust. If something
                doesn&apos;t feel right or doesn&apos;t quite add up — if
                something feels off or you aren&apos;t sure — just ask Arthur.
                We&apos;ll take a look together.
              </p>
            </div>

            <p className="mt-10 text-sm text-gov-slate italic">
              — Founder, Ask Arthur
            </p>
          </div>
        </section>

        {/* How It Works */}
        <section
          id="how-it-works"
          className="py-16 px-5 border-b border-border-light"
        >
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl font-extrabold text-deep-navy mb-2 text-center">
              How Ask Arthur works
            </h2>
            <p className="text-gov-slate text-center mb-10 text-sm">
              Three steps. Under 10 seconds.
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  step: "1",
                  icon: Search,
                  title: "Check",
                  description:
                    "Paste a message, link, phone number, or image. No account needed.",
                },
                {
                  step: "2",
                  icon: Zap,
                  title: "Analyse",
                  description:
                    "Our AI cross-references threat feeds, community reports, and known scam patterns.",
                },
                {
                  step: "3",
                  icon: CheckCircle,
                  title: "Protect",
                  description:
                    "Get a clear verdict — Safe, Suspicious, or High Risk — with actionable next steps.",
                },
              ].map(({ step, icon: Icon, title, description }) => (
                <div key={step} className="text-center">
                  <div className="w-12 h-12 rounded-full bg-action-teal/10 flex items-center justify-center mx-auto mb-3">
                    <Icon size={22} className="text-action-teal" />
                  </div>
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Step {step}
                  </div>
                  <h3 className="font-extrabold text-deep-navy text-lg mb-2">
                    {title}
                  </h3>
                  <p className="text-gov-slate text-sm leading-relaxed">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Australian Scam Insights */}
        {hasData && (
          <section className="py-16 px-5 bg-slate-50">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-2xl font-extrabold text-deep-navy mb-2 text-center">
                Australian scam insights
              </h2>
              <p className="text-gov-slate text-center text-sm mb-8">
                A snapshot of how Australians are using Ask Arthur to stay safe.
              </p>
              <ChartsSection
                safeCount={safeCount}
                suspiciousCount={suspiciousCount}
                highRiskCount={highRiskCount}
                stateData={stateData}
              />
            </div>
          </section>
        )}

        {/* World Scam Map */}
        <section className="py-16 px-5 border-b border-border-light">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl font-extrabold text-deep-navy mb-2 text-center">
              Scams around the world
            </h2>
            <p className="text-gov-slate text-center text-sm mb-8">
              Live scam reports from over 190 countries. Click any country to
              see the latest threats.
            </p>
            <WorldScamMap countryData={worldData} />
          </div>
        </section>

        {/* Aligned with Australia's authorities */}
        <section className="py-16 px-5 border-b border-border-light">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl font-extrabold text-deep-navy mb-2">
              Aligned with Australia&apos;s authorities
            </h2>
            <p className="text-gov-slate text-sm mb-8">
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
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
