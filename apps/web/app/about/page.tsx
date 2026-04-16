import type { Metadata } from "next";
import Link from "next/link";
import {
  Shield,
  ShieldCheck,
  Globe,
  Zap,
  Search,
  Bell,
  CheckCircle,
  Smartphone,
  Bot,
  Chrome,
  Code2,
  MessageSquare,
} from "lucide-react";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import ChartsSection from "@/components/charts/ChartsSection";
import WorldScamMap from "@/components/charts/WorldScamMap";
import { createServiceClient } from "@askarthur/supabase/server";
import { parseStateFromRegion } from "@/lib/chart-tokens";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "About Ask Arthur — Australia's Scam Detection Platform",
  description:
    "Ask Arthur was built by someone who got scammed twice. Now we help Australians spot scams before they strike — free, private, powered by AI.",
  openGraph: {
    title: "About Ask Arthur",
    description:
      "Built by someone who got scammed. Now protecting Australians from scams — one check at a time.",
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

const platforms = [
  { icon: Globe, name: "Web App", description: "Check anything instantly at askarthur.au", href: "/" },
  { icon: Smartphone, name: "Mobile App", description: "iOS & Android — check on the go", href: "#" },
  { icon: Bot, name: "Telegram Bot", description: "Forward suspicious messages directly", href: "#" },
  { icon: MessageSquare, name: "WhatsApp Bot", description: "Check scams where you chat most", href: "#" },
  { icon: Chrome, name: "Chrome Extension", description: "Protect yourself while you browse", href: "#" },
  { icon: Code2, name: "Developer API", description: "Embed scam intelligence into your product", href: "/api-docs" },
];

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

  const impactStats = [
    {
      value: totalChecks > 1000 ? `${(totalChecks / 1000).toFixed(0)}K+` : totalChecks > 0 ? `${totalChecks}+` : "10,000+",
      label: "Scam checks completed",
      icon: Shield,
    },
    {
      value: highRiskCount > 1000 ? `${(highRiskCount / 1000).toFixed(0)}K+` : highRiskCount > 0 ? `${highRiskCount}+` : "2,000+",
      label: "High-risk threats flagged",
      icon: ShieldCheck,
    },
    { value: "14+", label: "Threat intelligence feeds", icon: Bell },
    { value: "190+", label: "Countries with scam data", icon: Globe },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(aboutJsonLd).replace(/</g, "\\u003c"),
        }}
      />

      {/* Hero */}
      <section className="bg-deep-navy text-white py-20 px-5">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-1.5 text-sm font-medium mb-6">
            <Shield size={14} />
            Australia&apos;s scam detection platform
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight mb-4">
            Protecting Australians
            <br />
            from scams
          </h1>
          <p className="text-white/75 text-lg leading-relaxed mb-8 max-w-xl mx-auto">
            Free. Private. Powered by AI. Built because someone on our team got
            scammed — and realised too many people have no one to ask.
          </p>
          <Link
            href="/"
            className="inline-block bg-action-teal text-white font-bold px-8 py-3.5 rounded-xl hover:bg-action-teal/90 transition-colors"
          >
            Check something now
          </Link>
        </div>
      </section>

      <main id="main-content" className="flex-1">
        {/* Impact Stats */}
        <section className="py-16 px-5 border-b border-border-light">
          <div className="max-w-2xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {impactStats.map(({ value, label, icon: Icon }) => (
                <div key={label} className="text-center">
                  <Icon size={24} className="text-action-teal mx-auto mb-2" strokeWidth={1.5} />
                  <div className="text-3xl font-extrabold text-deep-navy tracking-tight">{value}</div>
                  <div className="text-xs text-gov-slate mt-1 leading-snug">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Founder Story */}
        <section className="py-16 px-5 bg-slate-50">
          <div className="max-w-2xl mx-auto">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-shrink-0">
                <div className="w-20 h-20 rounded-2xl bg-deep-navy/10 flex items-center justify-center">
                  <Shield size={36} className="text-deep-navy" strokeWidth={1.5} />
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-action-teal mb-3">
                  Why I built Ask Arthur
                </p>
                <h2 className="text-2xl font-extrabold text-deep-navy mb-5 leading-snug">
                  I got scammed. Twice.
                </h2>
                <div className="space-y-4 text-gov-slate text-base leading-relaxed">
                  <p>
                    The first time, I clicked a link I shouldn&apos;t have. It looked
                    real — official branding, urgent language, a familiar sender.
                    The second time, an investment scheme took advantage of me.
                    Convincing people, plausible returns, a polished pitch. Both
                    times, I handed over something I shouldn&apos;t have.
                  </p>
                  <p>
                    What I keep coming back to is this: in both cases, a brief
                    pause might have changed everything. A second opinion. Someone
                    — or something — to say:{" "}
                    <em>
                      &quot;Hold on. This looks suspicious. Here&apos;s what to do next.&quot;
                    </em>
                  </p>
                  <p>
                    A lot of people don&apos;t have that. They don&apos;t have a trusted
                    friend who knows about scams, or the confidence to question
                    something that feels slightly off. So I built Ask Arthur.
                  </p>
                  <p className="font-medium text-deep-navy">
                    Worst case, we advise caution — talk to your bank, download
                    the official app, speak to Scamwatch. Best case, we can report
                    the number and pass it on to the bank, telco, or company on
                    your behalf. Simple. Effective. Free.
                  </p>
                  <p>
                    Ask Arthur exists to help Australians spot scams before they
                    strike — and to raise awareness so fewer people go through what
                    I did.
                  </p>
                </div>
                <p className="mt-6 text-sm font-bold text-deep-navy">
                  — Founder, Ask Arthur
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="py-16 px-5 border-b border-border-light">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl font-extrabold text-deep-navy mb-2 text-center">
              How Ask Arthur works
            </h2>
            <p className="text-gov-slate text-center mb-10 text-sm">
              Three steps. Under 10 seconds.
            </p>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { step: "1", icon: Search, title: "Check", description: "Paste a message, link, phone number, or image. No account needed." },
                { step: "2", icon: Zap, title: "Analyse", description: "Our AI cross-references 14+ threat feeds, community reports, and known scam patterns." },
                { step: "3", icon: CheckCircle, title: "Protect", description: "Get a clear verdict — Safe, Suspicious, or High Risk — with actionable next steps." },
              ].map(({ step, icon: Icon, title, description }) => (
                <div key={step} className="text-center">
                  <div className="w-12 h-12 rounded-full bg-action-teal/10 flex items-center justify-center mx-auto mb-3">
                    <Icon size={22} className="text-action-teal" />
                  </div>
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">
                    Step {step}
                  </div>
                  <h3 className="font-extrabold text-deep-navy text-lg mb-2">{title}</h3>
                  <p className="text-gov-slate text-sm leading-relaxed">{description}</p>
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
              Live scam report data from our community. Click any country to see
              the latest threats.
            </p>
            <WorldScamMap countryData={worldData} />
          </div>
        </section>

        {/* Platforms */}
        <section className="py-16 px-5 bg-slate-50">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-2xl font-extrabold text-deep-navy mb-2 text-center">
              Protect yourself everywhere
            </h2>
            <p className="text-gov-slate text-center text-sm mb-8">
              Ask Arthur works across every platform you use.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {platforms.map(({ icon: Icon, name, description, href }) => (
                <Link
                  key={name}
                  href={href}
                  className="rounded-xl border border-border-light bg-white p-4 hover:border-action-teal/40 hover:shadow-sm transition-all group"
                >
                  <Icon size={20} className="text-action-teal mb-2 group-hover:scale-110 transition-transform" />
                  <div className="font-bold text-deep-navy text-sm">{name}</div>
                  <div className="text-xs text-gov-slate mt-0.5 leading-snug">{description}</div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* Data Sources */}
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

        {/* Press / Media */}
        <section className="py-12 px-5 bg-slate-50">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-lg font-extrabold text-deep-navy mb-2">
              Media & press
            </h2>
            <p className="text-gov-slate text-sm mb-4">
              Writing about scams, cybersecurity, or Ask Arthur?
            </p>
            <a
              href="mailto:media@askarthur.au"
              className="inline-block text-action-teal font-bold text-sm hover:underline"
            >
              media@askarthur.au
            </a>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 px-5 bg-deep-navy text-white text-center">
          <div className="max-w-xl mx-auto">
            <Shield size={40} className="mx-auto mb-4 opacity-60" strokeWidth={1.5} />
            <h2 className="text-3xl font-extrabold mb-3 leading-tight">
              Start protecting yourself — free
            </h2>
            <p className="text-white/70 mb-8">
              No account. No sign-up. Just paste and check.
            </p>
            <Link
              href="/"
              className="inline-block bg-action-teal text-white font-bold px-8 py-3.5 rounded-xl hover:bg-action-teal/90 transition-colors"
            >
              Check a message now
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
