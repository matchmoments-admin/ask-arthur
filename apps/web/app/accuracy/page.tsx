import type { Metadata } from "next";
import { createServiceClient } from "@askarthur/supabase/server";

export const metadata: Metadata = {
  title: "Accuracy | Ask Arthur",
  description:
    "Rolling 30-day false-positive and false-negative rates from real user feedback. Honest, verifiable, unsolicited.",
};

// Don't cache too aggressively — this page is the trust signal, so it
// should reflect recent reality. Hourly is plenty.
export const revalidate = 3600;

interface VerdictBreakdown {
  verdict: string;
  total: number;
  correct: number;
  falsePositive: number;
  falseNegative: number;
  reported: number;
}

const VERDICT_ORDER = ["HIGH_RISK", "SUSPICIOUS", "SAFE"] as const;
const VERDICT_LABEL: Record<string, string> = {
  HIGH_RISK: "Looks like a scam",
  SUSPICIOUS: "Suspicious",
  SAFE: "No clear flags",
};

async function loadStats(): Promise<{
  byVerdict: VerdictBreakdown[];
  totalFeedback: number;
  windowDays: number;
} | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("verdict_feedback")
    .select("verdict_given, user_says")
    .gte("created_at", since);

  if (error || !data) return { byVerdict: [], totalFeedback: 0, windowDays: 30 };

  const buckets = new Map<string, VerdictBreakdown>();
  for (const v of VERDICT_ORDER) {
    buckets.set(v, {
      verdict: v,
      total: 0,
      correct: 0,
      falsePositive: 0,
      falseNegative: 0,
      reported: 0,
    });
  }

  for (const row of data as Array<{ verdict_given: string; user_says: string }>) {
    const b = buckets.get(row.verdict_given);
    if (!b) continue;
    b.total += 1;
    if (row.user_says === "correct") b.correct += 1;
    else if (row.user_says === "false_positive") b.falsePositive += 1;
    else if (row.user_says === "false_negative") b.falseNegative += 1;
    else if (row.user_says === "user_reported") b.reported += 1;
  }

  return {
    byVerdict: VERDICT_ORDER.map((v) => buckets.get(v)!),
    totalFeedback: data.length,
    windowDays: 30,
  };
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

export default async function AccuracyPage() {
  const stats = await loadStats();

  return (
    <main className="max-w-[720px] mx-auto px-5 py-12">
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-gov-slate mb-2">
          Trust signal
        </p>
        <h1 className="text-3xl font-bold text-deep-navy">
          How accurate is Arthur?
        </h1>
        <p className="mt-3 text-base text-gov-slate leading-relaxed">
          We don&apos;t ask happy users for reviews. We let everyone — happy or
          unhappy — vote 👍 or 👎 on every check, and we publish the totals here.
          The numbers move when you submit feedback. They&apos;re sometimes
          uncomfortable, and that&apos;s the point.
        </p>
      </header>

      {!stats ? (
        <p className="mt-8 text-sm text-gov-slate">
          Stats temporarily unavailable.
        </p>
      ) : stats.totalFeedback === 0 ? (
        <section className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-sm text-gov-slate">
            No feedback yet in the last 30 days. Run a check, vote on the
            verdict, and the numbers below will populate.
          </p>
        </section>
      ) : (
        <section className="mt-8">
          <p className="text-xs uppercase tracking-widest text-gov-slate mb-3">
            Rolling {stats.windowDays} days · {stats.totalFeedback} feedback
            ratings
          </p>

          <div className="space-y-3">
            {stats.byVerdict.map((b) => {
              if (b.total === 0) return null;
              const accuracy = b.total - b.falsePositive - b.falseNegative;
              return (
                <article
                  key={b.verdict}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <header className="flex items-center justify-between gap-3 mb-2">
                    <h2 className="font-bold text-deep-navy text-sm">
                      {VERDICT_LABEL[b.verdict] ?? b.verdict}
                    </h2>
                    <span className="text-xs text-gov-slate">
                      {b.total} ratings
                    </span>
                  </header>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-gov-slate">Confirmed correct</dt>
                      <dd className="font-bold text-deep-navy text-base mt-0.5">
                        {pct(accuracy, b.total)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gov-slate">False positive</dt>
                      <dd className="font-bold text-amber-700 text-base mt-0.5">
                        {pct(b.falsePositive, b.total)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gov-slate">False negative</dt>
                      <dd className="font-bold text-red-700 text-base mt-0.5">
                        {pct(b.falseNegative, b.total)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-gov-slate">User reports</dt>
                      <dd className="font-bold text-deep-navy text-base mt-0.5">
                        {b.reported}
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-10 rounded-lg border border-slate-200 bg-slate-50 p-5">
        <h2 className="font-bold text-deep-navy text-sm mb-2">
          What these numbers mean
        </h2>
        <ul className="text-sm text-gov-slate leading-relaxed space-y-1.5 list-disc pl-5">
          <li>
            <strong>False positive</strong> — Arthur said it looked like a scam,
            but the user says it wasn&apos;t. The cost is alarming someone over
            something safe.
          </li>
          <li>
            <strong>False negative</strong> — Arthur said it looked OK, but the
            user says it actually was a scam. This is the worst kind of error,
            because the user might trust the false reassurance.
          </li>
          <li>
            <strong>User reports</strong> — How many users clicked &quot;Report
            this scam&quot; on a verdict, sending evidence to Scamwatch and
            related destinations.
          </li>
        </ul>
        <p className="text-sm text-gov-slate mt-3 leading-relaxed">
          We don&apos;t paywall this page or filter the data. If the rates look
          bad we&apos;ll fix the model — that&apos;s what the feedback loop is
          for.
        </p>
      </section>
    </main>
  );
}
