// Per-day infra-spend rollup view — reads from infra_cost_daily (v134).
//
// Complements /admin/costs (per-call AI telemetry) with the cloud-provider
// daily billing rolled up by the billing-ingest-nightly Inngest function.
// One row per (date, provider). Three providers currently: vercel,
// anthropic, supabase-base. Extend in billing-ingest-nightly.ts when more
// providers come online (github-actions deferred — needs gh `user` scope).

import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";

export const dynamic = "force-dynamic";

interface InfraRow {
  date: string;
  provider: string;
  usd_cents: number;
  ingested_at: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  vercel: "Vercel (Functions, Bandwidth, etc.)",
  anthropic: "Anthropic (Claude API)",
  "supabase-base": "Supabase Pro base",
  "github-actions": "GitHub Actions",
};

function thirtyDaysAgoIsoDate(): string {
  return new Date(Date.now() - 30 * 86400_000).toISOString().split("T")[0];
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function InfraCostsPage() {
  await requireAdmin();

  const supabase = createServiceClient();
  let rows: InfraRow[] = [];

  if (supabase) {
    const since = thirtyDaysAgoIsoDate();
    const { data } = await supabase
      .from("infra_cost_daily")
      .select("date, provider, usd_cents, ingested_at")
      .gte("date", since)
      .order("date", { ascending: false })
      .order("provider", { ascending: true });
    rows = (data ?? []) as InfraRow[];
  }

  // Per-provider 30-day totals.
  const providerTotals = new Map<string, number>();
  for (const r of rows) {
    providerTotals.set(
      r.provider,
      (providerTotals.get(r.provider) ?? 0) + r.usd_cents,
    );
  }
  const totalCents = Array.from(providerTotals.values()).reduce(
    (s, v) => s + v,
    0,
  );

  // Per-day grand totals (for the trend table).
  const byDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, new Map());
    byDay.get(r.date)!.set(r.provider, r.usd_cents);
  }
  const providers = Array.from(providerTotals.keys()).sort();
  const days = Array.from(byDay.keys()).sort((a, b) => (a < b ? 1 : -1));

  const latestIngest = rows
    .map((r) => r.ingested_at)
    .sort()
    .at(-1);

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

      <section className="mb-8">
        <h2 className="text-deep-navy text-sm font-semibold uppercase tracking-wider mb-3">
          30-day totals
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
