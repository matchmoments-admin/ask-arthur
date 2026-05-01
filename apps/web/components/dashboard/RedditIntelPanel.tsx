// Reddit Intelligence dashboard widget.
//
// Server component — fetches the latest daily summary + active themes via
// service-role Supabase reads. Renders an empty state when no data is
// available yet (flag just flipped, classifier hasn't run). Renders a stale-
// data badge when the most recent classification is >36h ago.
//
// No client-side interactivity beyond what shadcn/ui's static cards offer.
// If we add interactive filtering later, split into a Suspense'd client
// island rather than converting the whole panel.

import {
  getLatestRedditIntelSummary,
  getActiveRedditIntelThemes,
  getRedditIntelFreshness,
} from "@/lib/reddit-intel";

const STALE_HOURS_AMBER = 36;
const STALE_HOURS_RED = 72;

function formatHoursAgo(hours: number): string {
  if (hours < 1) return "<1h ago";
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function FreshnessBadge({
  latestProcessedAt,
  hoursStale,
}: {
  latestProcessedAt: string | null;
  hoursStale: number | null;
}) {
  if (!latestProcessedAt || hoursStale === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
        no data yet
      </span>
    );
  }
  const tone =
    hoursStale > STALE_HOURS_RED
      ? "bg-red-100 text-red-700"
      : hoursStale > STALE_HOURS_AMBER
        ? "bg-amber-100 text-amber-700"
        : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>
      updated {formatHoursAgo(hoursStale)}
    </span>
  );
}

export default async function RedditIntelPanel() {
  // Three independent fetches; run in parallel.
  const [summary, themes, freshness] = await Promise.all([
    getLatestRedditIntelSummary(),
    getActiveRedditIntelThemes(8),
    getRedditIntelFreshness(),
  ]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold text-deep-navy">
            Reddit Scam Pulse
          </h2>
          <p className="text-xs text-slate-500">
            Narrative intelligence from r/scams &amp; r/auscams, classified by
            Sonnet 4.6.
          </p>
        </div>
        <FreshnessBadge
          latestProcessedAt={freshness.latestProcessedAt}
          hoursStale={freshness.hoursStale}
        />
      </header>

      {!summary ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
          No daily summary yet. The classifier runs every 6h via the
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-[11px]">
            reddit-intel-trigger
          </code>
          cron. Check Inngest dashboard if no data appears within 12h of
          flipping <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-[11px]">FF_REDDIT_INTEL_INGEST=true</code>.
        </div>
      ) : (
        <>
          {/* Lead narrative — 3 paragraphs, ~250 words. */}
          <div className="mb-5 space-y-3 text-sm leading-6 text-slate-700">
            {summary.leadNarrative.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

          {/* Stats strip */}
          <div className="mb-5 grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-center">
            <Stat label="Posts classified" value={summary.postsClassified} />
            <Stat
              label="Top category"
              value={topKey(summary.stats.topCategories) ?? "—"}
              monospace
            />
            <Stat
              label="Top brand"
              value={topKey(summary.stats.topBrands) ?? "—"}
            />
          </div>

          {/* Emerging threats — at most 5, from the daily summary jsonb */}
          {summary.emergingThreats.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Emerging this cohort
              </h3>
              <ul className="space-y-2">
                {summary.emergingThreats.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-slate-100 bg-slate-50 p-3"
                  >
                    <div className="text-sm font-medium text-deep-navy">
                      {t.title}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {t.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Brand watchlist — horizontal pills */}
          {summary.brandWatchlist.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Brands impersonated
              </h3>
              <div className="flex flex-wrap gap-2">
                {summary.brandWatchlist.map((b) => (
                  <span
                    key={b.brand}
                    className="inline-flex items-center gap-1.5 rounded-full bg-deep-navy/5 px-3 py-1 text-xs text-deep-navy"
                  >
                    {b.brand}
                    <span className="text-[10px] text-slate-500">
                      ×{b.mentionCount}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Theme cards — independent of daily summary; render when present. */}
      {themes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Active themes ({themes.length})
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {themes.map((theme) => (
              <article
                key={theme.id}
                className="rounded-lg border border-slate-100 bg-white p-3"
              >
                <header className="mb-1 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-deep-navy">
                    {theme.title}
                  </h4>
                  <span className="text-[10px] text-slate-500">
                    {theme.memberCount} posts
                  </span>
                </header>
                {theme.narrative && (
                  <p className="text-xs leading-5 text-slate-600">
                    {theme.narrative}
                  </p>
                )}
                {theme.representativeBrands.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {theme.representativeBrands.slice(0, 3).map((b) => (
                      <span
                        key={b}
                        className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                      >
                        {b}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      )}

      {summary && (
        <footer className="mt-5 border-t border-slate-100 pt-3 text-[10px] text-slate-400">
          {summary.cohortDate} · {summary.modelVersion} ·{" "}
          {summary.promptVersion}
        </footer>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  monospace,
}: {
  label: string;
  value: string | number;
  monospace?: boolean;
}) {
  return (
    <div>
      <div
        className={`text-base font-semibold text-deep-navy ${
          monospace ? "font-mono text-sm" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
    </div>
  );
}

function topKey(obj: Record<string, number>): string | null {
  let bestKey: string | null = null;
  let bestVal = -Infinity;
  for (const [k, v] of Object.entries(obj)) {
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  return bestKey;
}
