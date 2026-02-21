import SubscribeForm from "@/components/SubscribeForm";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import ChartsSection from "@/components/charts/ChartsSection";
import { createServiceClient } from "@/lib/supabase";
import { parseStateFromRegion } from "@/lib/chart-tokens";

export const revalidate = 3600; // re-fetch hourly

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

export default async function AboutPage() {
  const { safeCount, suspiciousCount, highRiskCount, stateData } =
    await getChartData();

  const hasData = safeCount + suspiciousCount + highRiskCount > 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      <main id="main-content" className="flex-1 w-full max-w-[640px] mx-auto px-5 pt-16 pb-12">
        <h1 className="text-deep-navy text-3xl font-extrabold mb-8">About Ask Arthur</h1>

        {/* Personal story */}
        <section className="mb-12">
          <p className="text-gov-slate text-base leading-relaxed mb-4">
            Scams are getting smarter. AI-generated phishing emails, fake texts from
            &quot;your bank,&quot; romance scams that play out over weeks — they&apos;re designed
            to trick even savvy people. And for older adults, the consequences can be
            devastating.
          </p>
          <p className="text-gov-slate text-base leading-relaxed">
            We built Ask Arthur because everyone deserves a quick, free way to check
            if something is a scam — without needing to be a cybersecurity expert.
            Just paste the message and get a clear, honest answer.
          </p>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="mb-12">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-6">How It Works</h2>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-deep-navy/10 text-deep-navy flex items-center justify-center font-semibold text-sm">
                1
              </div>
              <div>
                <h3 className="text-deep-navy font-semibold mb-1">Paste or upload</h3>
                <p className="text-gov-slate text-base leading-relaxed">
                  Copy the suspicious message, email, or URL into the checker.
                  You can also upload a screenshot of a text message or social media post.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-deep-navy/10 text-deep-navy flex items-center justify-center font-semibold text-sm">
                2
              </div>
              <div>
                <h3 className="text-deep-navy font-semibold mb-1">AI analyzes it</h3>
                <p className="text-gov-slate text-base leading-relaxed">
                  Our AI checks for known scam patterns, urgency tactics, suspicious
                  URLs, brand impersonation, and other red flags — in seconds.
                </p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-deep-navy/10 text-deep-navy flex items-center justify-center font-semibold text-sm">
                3
              </div>
              <div>
                <h3 className="text-deep-navy font-semibold mb-1">Get a clear verdict</h3>
                <p className="text-gov-slate text-base leading-relaxed">
                  You&apos;ll see a clear Safe, Suspicious, or High Risk verdict with
                  a plain-language explanation of what we found and what to do next.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Scam Check Insights — only render when we have data */}
        {hasData && (
          <section className="mb-12">
            <h2 className="text-deep-navy text-2xl font-extrabold mb-6">
              Scam Check Insights
            </h2>
            <p className="text-gov-slate text-base leading-relaxed mb-8">
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

        {/* Privacy */}
        <section id="privacy" className="mb-12">
          <h2 className="text-deep-navy text-2xl font-extrabold mb-4">Our Privacy Commitment</h2>
          <ul className="space-y-3">
            {[
              "We never store the messages you check. They're analyzed and immediately discarded.",
              "We never store your IP address or create user profiles.",
              "We don't use cookies or third-party trackers.",
              "Analytics are privacy-first (Plausible — no personal data collected).",
              "When scam patterns are saved for research, all personal information is scrubbed first.",
              "This tool is free and requires no signup.",
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-gov-slate text-base leading-relaxed">
                <svg className="w-5 h-5 text-deep-navy flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Subscribe */}
        <SubscribeForm />
      </main>

      <Footer />
    </div>
  );
}
