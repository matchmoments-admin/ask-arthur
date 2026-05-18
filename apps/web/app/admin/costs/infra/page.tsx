// Per-day infra-spend rollup view — reads from infra_cost_daily (v134).
//
// Complements /admin/costs (per-call AI telemetry) with the cloud-provider
// daily billing rolled up by the billing-ingest-nightly Inngest function.
// Three active providers: vercel, anthropic, github-actions.
//
// supabase-base was a 4th provider in PR #309 — removed because it
// wrote $0.83/day every day forever (Supabase Pro is invariant) and
// adds no signal vs the static "Fixed monthly subscriptions" card here.
// Historical 'supabase-base' rows in infra_cost_daily are left in the
// DB but filtered out at the page render layer.

import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export const dynamic = "force-dynamic";

interface InfraRow {
  date: string;
  provider: string;
  usd_cents: number;
  ingested_at: string;
  raw_usage_jsonb: Record<string, unknown> | null;
}

const PROVIDER_LABELS: Record<string, string> = {
  vercel: "Vercel",
  anthropic: "Anthropic (Claude API)",
  "github-actions": "GitHub Actions",
  // Historical-only — filtered out of the dashboard but labelled so
  // anyone querying the DB directly sees a meaningful name.
  "supabase-base": "Supabase Pro (historical — see fixed subscriptions)",
};

const FIXED_SUBSCRIPTIONS: { label: string; monthlyUsd: number; note?: string }[] = [
  {
    label: "Supabase Pro",
    monthlyUsd: Number(process.env.INFRA_COST_SUPABASE_MONTHLY_BASE_USD ?? "25"),
    note: "Flat-rate; variable compute/storage/egress not exposed via API",
  },
];

// Providers whose row should appear in the dashboard. `supabase-base`
// historical rows stay in the DB but skip the UI.
const ACTIVE_PROVIDERS = new Set(["vercel", "anthropic", "github-actions"]);

function thirtyDaysAgoIsoDate(): string {
  return new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatUsdMonthly(usd: number): string {
  return `$${usd.toFixed(2)}/mo`;
}

interface VercelServicesBreakdown {
  service: string;
  cents: number;
}

/**
 * Read the most-recent Vercel row's raw_usage_jsonb.services map and
 * surface the top services for the day. Per-day shape is informative
 * because build minutes typically dominate.
 */
function extractTopVercelServices(rows: InfraRow[]): VercelServicesBreakdown[] {
  const vercelRows = rows.filter((r) => r.provider === "vercel");
  if (vercelRows.length === 0) return [];

  // Aggregate `services` across all 30 days, not just one day. The Inngest
  // function captures EffectiveCost-per-service (USD as a float) inside
  // raw_usage_jsonb.services for each daily ingest.
  const totals = new Map<string, number>();
  for (const row of vercelRows) {
    const services = (row.raw_usage_jsonb as { services?: Record<string, number> })
      ?.services;
    if (!services) continue;
    for (const [svc, usd] of Object.entries(services)) {
      const dollars = Number(usd);
      if (!Number.isFinite(dollars)) continue;
      totals.set(svc, (totals.get(svc) ?? 0) + dollars);
    }
  }

  return Array.from(totals.entries())
    .map(([service, dollars]) => ({ service, cents: Math.round(dollars * 100) }))
    .sort((a, b) => b.cents - a.cents)
    .slice(0, 8);
}

export default async function InfraCostsPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let rows: InfraRow[] = [];

  if (supabase) {
    const since = thirtyDaysAgoIsoDate();
    const { data } = await supabase
      .from("infra_cost_daily")
      .select("date, provider, usd_cents, ingested_at, raw_usage_jsonb")
      .gte("date", since)
      .order("date", { ascending: false })
      .order("provider", { ascending: true });
    rows = (data ?? []) as InfraRow[];
  }

  // Filter out historical / inactive providers BEFORE aggregating.
  const activeRows = rows.filter((r) => ACTIVE_PROVIDERS.has(r.provider));

  // Per-provider 30-day totals.
  const providerTotals = new Map<string, number>();
  for (const r of activeRows) {
    providerTotals.set(
      r.provider,
      (providerTotals.get(r.provider) ?? 0) + r.usd_cents,
    );
  }
  const totalCents = Array.from(providerTotals.values()).reduce(
    (s, v) => s + v,
    0,
  );

  // Per-day breakdown matrix.
  const byDay = new Map<string, Map<string, number>>();
  for (const r of activeRows) {
    if (!byDay.has(r.date)) byDay.set(r.date, new Map());
    byDay.get(r.date)!.set(r.provider, r.usd_cents);
  }
  const providers = Array.from(providerTotals.keys()).sort();
  const days = Array.from(byDay.keys()).sort((a, b) => (a < b ? 1 : -1));

  const latestIngest = activeRows
    .map((r) => r.ingested_at)
    .sort()
    .at(-1);

  // Top Vercel services breakdown (built from raw_usage_jsonb).
  const topVercelServices = extractTopVercelServices(activeRows);
  const topVercelTotalCents = topVercelServices.reduce(
    (s, r) => s + r.cents,
    0,
  );

  // Variable + fixed combined view at the top.
  const fixedMonthlyTotalUsd = FIXED_SUBSCRIPTIONS.reduce(
    (s, f) => s + f.monthlyUsd,
    0,
  );

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <h1 className="text-deep-navy text-xl font-extrabold mb-1">
        Infra cost rollup
      </h1>
      <p className="text-gov-slate text-sm mb-6">
        Daily cloud-provider billing aggregated by{" "}
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
          billing-ingest-nightly
        </code>{" "}
        (02:00 UTC). Complements{" "}
        <a href="/admin/costs" className="text-action-teal underline">
          /admin/costs
        </a>{" "}
        (per-call AI telemetry) with the non-event-driven spend providers
        report via their own APIs.
        {latestIngest && (
          <>
            {" "}Last ingest:{" "}
            <span className="font-mono text-xs">
              {new Date(latestIngest).toISOString().replace("T", " ").slice(0, 16)} UTC
            </span>
            .
          </>
        )}
      </p>

      {/* Fixed subscriptions — invariant per month, not part of the daily ingest. */}
      <section className="mb-8">
        <h2 className="text-deep-navy text-sm font-semibold uppercase tracking-wider mb-3">
          Fixed monthly subscriptions
        </h2>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs text-gov-slate mb-3 leading-relaxed">
            Flat-rate subscriptions not tracked in the daily ingest. Vercel Pro
            and GitHub Actions baselines ARE captured by their respective
            billing APIs, so they appear inside the per-day totals below.
          </p>
          <ul className="space-y-1">
            {FIXED_SUBSCRIPTIONS.map((sub) => (
              <li
                key={sub.label}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="text-deep-navy font-medium">{sub.label}</span>
                <span className="flex-1 text-xs text-gov-slate truncate">
                  {sub.note ?? ""}
                </span>
                <span className="font-mono tabular-nums text-deep-navy font-semibold">
                  {formatUsdMonthly(sub.monthlyUsd)}
                </span>
              </li>
            ))}
            <li className="flex items-baseline justify-between pt-2 mt-2 border-t border-slate-200 text-sm">
              <span className="text-deep-navy font-semibold">Fixed total</span>
              <span className="flex-1" />
              <span className="font-mono tabular-nums text-deep-navy font-extrabold">
                {formatUsdMonthly(fixedMonthlyTotalUsd)}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-deep-navy text-sm font-semibold uppercase tracking-wider mb-3">
          Variable spend — last 30 days
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-deep-navy bg-deep-navy text-white p-4">
            <div className="text-xs uppercase tracking-wide opacity-80">
              All providers
            </div>
            <div className="text-2xl font-extrabold mt-1 tabular-nums">
              {formatUsd(totalCents)}
            </div>
            <div className="text-xs opacity-80 mt-1">30 days</div>
          </div>
          {Array.from(providerTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([provider, cents]) => (
              <div
                key={provider}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <div className="text-xs uppercase tracking-wide text-gov-slate">
                  {PROVIDER_LABELS[provider] ?? provider}
                </div>
                <div className="text-2xl font-extrabold text-deep-navy mt-1 tabular-nums">
                  {formatUsd(cents)}
                </div>
                <div className="text-xs text-gov-slate mt-1">
                  {totalCents === 0
                    ? "—"
                    : `${Math.round((cents / totalCents) * 100)}% of total`}
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* Top Vercel services — surfaces the build-minute dominance. */}
      {topVercelServices.length > 0 && (
        <section className="mb-8">
          <h2 className="text-deep-navy text-sm font-semibold uppercase tracking-wider mb-3">
            Top Vercel services — 30 days
          </h2>
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-gov-slate">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Service</th>
                  <th className="text-right px-3 py-2 font-semibold">
                    30d total
                  </th>
                  <th className="text-right px-3 py-2 font-semibold">
                    % of Vercel
                  </th>
                </tr>
              </thead>
              <tbody>
                {topVercelServices.map((row) => (
                  <tr key={row.service} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-deep-navy">{row.service}</td>
                    <td className="px-3 py-2 text-right text-gov-slate">
                      {formatUsd(row.cents)}
                    </td>
                    <td className="px-3 py-2 text-right text-gov-slate">
                      {topVercelTotalCents === 0
                        ? "—"
                        : `${Math.round((row.cents / topVercelTotalCents) * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-gov-slate leading-relaxed">
            Build CPU + Build Minutes typically dominate. If they{"’"}re
            over $20/mo, check whether Turbo Remote Cache is wired in Vercel
            env (<code className="font-mono">TURBO_TOKEN</code> +{" "}
            <code className="font-mono">TURBO_TEAM</code>) — cold builds run
            5-10× the CPU time of cache-hit builds.
          </p>
        </section>
      )}

      <section>
        <h2 className="text-deep-navy text-sm font-semibold uppercase tracking-wider mb-3">
          Daily breakdown
        </h2>
        {days.length === 0 ? (
          <p className="text-gov-slate text-sm py-8 text-center bg-slate-50 rounded-lg">
            No rows yet. The first row lands at 02:00 UTC tomorrow.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-gov-slate">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Date</th>
                  {providers.map((p) => (
                    <th key={p} className="text-right px-3 py-2 font-semibold">
                      {p}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const dayRow = byDay.get(day)!;
                  const dayTotal = Array.from(dayRow.values()).reduce(
                    (s, v) => s + v,
                    0,
                  );
                  return (
                    <tr key={day} className="border-t border-slate-100">
                      <td className="px-3 py-2 font-mono text-xs text-deep-navy">
                        {day}
                      </td>
                      {providers.map((p) => (
                        <td key={p} className="px-3 py-2 text-right text-gov-slate">
                          {dayRow.has(p) ? formatUsd(dayRow.get(p)!) : "—"}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold text-deep-navy">
                        {formatUsd(dayTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
