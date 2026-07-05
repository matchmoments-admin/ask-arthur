// Clone Watch monthly index — the owned-media home for each month's data drop
// (/clone-watch/2026-06). Reads the durable clone_watch_report_summary row
// (v189) that the monthly Inngest snapshot + LinkedIn automation already
// populate, so the page reconciles exactly with the carousel/caption.
//
// Read path: service-role Supabase client server-side (the table is
// service-role-only per v189 RLS) — same posture as the pillar page. NEVER via
// browser supabase-js.
//
// `noindex` until FF_CLONE_WATCH_PUBLIC is ON (waits on #371 vetted copy); the
// route still renders behind noindex so it can be previewed.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";

export const revalidate = 3600; // 1 hour ISR

interface RankedBrand {
  brand: string;
  clones: number;
}
interface RankedRegistrar {
  registrar: string;
  clones: number;
}
interface SuperFund {
  brand: string;
  clones: number;
  auRank: number;
}
interface MonthOverMonth {
  available: boolean;
  priorLabel: string;
  totalDelta: number;
  totalPct: number | null;
  brandsDelta: number;
}
interface SummaryRow {
  period_month: string;
  total_domains: number;
  brand_count: number;
  reported_to_netcraft: number;
  likely_phishing: number;
  parked_for_sale: number;
  unknown_registrar_count: number;
  top_au_brands: RankedBrand[];
  global_brands: RankedBrand[];
  top_registrars: RankedRegistrar[];
  super_fund: SuperFund | null;
  mom: MonthOverMonth | null;
}

// "2026-06" (URL) <-> "2026-06-01" (period_month date). Validates a real
// calendar month (01-12) so a bad slug 404s instead of hitting the DB with an
// out-of-range date.
function toPeriodMonth(period: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${period}-01`;
}
function periodLabel(periodMonth: string): string {
  const d = new Date(`${periodMonth}T00:00:00Z`);
  return d.toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function getSummary(period: string): Promise<SummaryRow | null> {
  const pm = toPeriodMonth(period);
  if (!pm) return null;
  const supabase = createServiceClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("clone_watch_report_summary")
    .select(
      "period_month, total_domains, brand_count, reported_to_netcraft, likely_phishing, parked_for_sale, unknown_registrar_count, top_au_brands, global_brands, top_registrars, super_fund, mom",
    )
    .eq("period_month", pm)
    .maybeSingle();
  return (data as SummaryRow | null) ?? null;
}

// Pre-build the months that already have a summary row. dynamicParams stays ON
// (default) so a brand-new edition renders on-demand the moment its summary row
// exists — no redeploy needed, and the pillar/sitemap only ever link real
// editions. Trade-off: a non-existent month renders the not-found body with a
// 200 (ISR caches the notFound outcome — a soft-404). Inert while these pages
// are noindex; revisit if it matters once FF_CLONE_WATCH_PUBLIC is flipped.
export async function generateStaticParams(): Promise<{ period: string }[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("clone_watch_report_summary")
    .select("period_month")
    .order("period_month", { ascending: false });
  return (data ?? []).map((r) => ({
    period: (r.period_month as string).slice(0, 7),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ period: string }>;
}): Promise<Metadata> {
  const { period } = await params;
  const pm = toPeriodMonth(period);
  const label = pm ? periodLabel(pm) : period;
  const indexable = featureFlags.cloneWatchPublic;
  return {
    title: `Clone Watch — ${label} | Ask Arthur`,
    description: `Australian brand-lookalike domain observations for ${label}: totals, most-targeted brands, registrar breakdown, and takedown actions.`,
    robots: { index: indexable, follow: indexable },
  };
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-deep-navy/15 bg-white p-4">
      <p
        className="text-2xl md:text-3xl font-extrabold text-deep-navy"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
      <p className="text-[11px] text-gov-slate mt-0.5 leading-snug">{label}</p>
    </div>
  );
}

function BrandBars({ rows }: { rows: RankedBrand[] }) {
  const max = Math.max(1, ...rows.map((r) => r.clones));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.brand} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate text-deep-navy">{r.brand}</span>
          <span
            className="h-4 rounded-sm bg-deep-navy/70"
            style={{ width: `${Math.round((r.clones / max) * 100)}%`, minWidth: 4 }}
          />
          <span className="text-gov-slate tabular-nums">{r.clones}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function CloneWatchMonthPage({
  params,
}: {
  params: Promise<{ period: string }>;
}) {
  const { period } = await params;
  const row = await getSummary(period);
  if (!row) notFound();

  const label = periodLabel(row.period_month);
  const mom = row.mom;
  const momLine =
    mom?.available && mom.totalPct !== null
      ? `${mom.totalDelta >= 0 ? "+" : ""}${mom.totalDelta} (${mom.totalPct >= 0 ? "+" : ""}${mom.totalPct.toFixed(0)}%) vs ${mom.priorLabel}`
      : null;

  return (
    <>
      <div className="mb-4 text-xs font-bold uppercase tracking-widest text-deep-navy">
        <Link href="/clone-watch" className="hover:underline">
          Clone Watch
        </Link>{" "}
        · monthly edition
      </div>
      <h1 className="text-deep-navy text-4xl md:text-5xl font-extrabold mb-3 leading-tight">
        {label}
      </h1>
      <p className="text-lg text-gov-slate mb-8 leading-relaxed">
        Suspected brand-lookalike domains observed across our Australian brand
        watch-list this month — a factual, public-registry measurement. See{" "}
        <Link href="/clone-watch/method" className="underline">
          how we measure this
        </Link>
        . These are suspected lookalikes submitted for review, not adjudicated
        findings.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <StatTile label="Lookalike domains" value={row.total_domains.toLocaleString()} />
        <StatTile label="Brands affected" value={row.brand_count.toLocaleString()} />
        <StatTile label="Submitted for takedown review" value={row.reported_to_netcraft.toLocaleString()} />
        <StatTile label="Flagged likely phishing" value={row.likely_phishing.toLocaleString()} />
      </div>
      {momLine && (
        <p className="text-sm text-gov-slate mb-8">
          Month on month: <span className="font-semibold text-deep-navy">{momLine}</span>{" "}
          lookalike domains ({mom!.brandsDelta >= 0 ? "+" : ""}
          {mom!.brandsDelta} brands).
        </p>
      )}

      {row.super_fund && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 mb-8 text-sm leading-relaxed text-amber-900">
          <p className="font-semibold mb-1">Spotlight: superannuation</p>
          <p>
            {row.super_fund.brand} was the #{row.super_fund.auRank} most-targeted
            Australian brand this month ({row.super_fund.clones} lookalike
            domains) — a sign impersonation has moved beyond banks and retail to
            any trusted brand with money attached.
          </p>
        </div>
      )}

      {row.top_au_brands.length > 0 && (
        <section className="mb-8">
          <h2 className="text-deep-navy text-sm font-bold mb-3">Most-targeted Australian brands</h2>
          <BrandBars rows={row.top_au_brands} />
        </section>
      )}

      {row.global_brands.length > 0 && (
        <section className="mb-8">
          <h2 className="text-deep-navy text-sm font-bold mb-3">Global brands targeted</h2>
          <BrandBars rows={row.global_brands} />
        </section>
      )}

      {row.top_registrars.length > 0 && (
        <section className="mb-8">
          <h2 className="text-deep-navy text-sm font-bold mb-2">Where the domains were registered</h2>
          <p className="text-xs text-gov-slate mb-3">
            Aggregate registrar counts over the month. Raw counts partly reflect
            registrar size, and {row.unknown_registrar_count} domains hid behind
            WHOIS privacy. Registrars are named in aggregate only — not accused of
            wrongdoing.
          </p>
          <ul className="space-y-1.5">
            {row.top_registrars.map((r) => (
              <li key={r.registrar} className="flex items-center justify-between text-sm border-b border-deep-navy/10 py-1">
                <span className="text-deep-navy">{r.registrar}</span>
                <span className="text-gov-slate tabular-nums">{r.clones}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 mb-10">
        <StatTile label="Parked / for sale" value={row.parked_for_sale.toLocaleString()} />
        <StatTile label="Registrant hidden (WHOIS privacy)" value={row.unknown_registrar_count.toLocaleString()} />
      </div>

      <div className="rounded-xl border border-deep-navy/15 bg-deep-navy/[0.04] p-5">
        <p className="text-sm text-deep-navy font-semibold mb-1">Spotted a fake site?</p>
        <p className="text-sm text-gov-slate leading-relaxed">
          Report it to the brand, to Scamwatch (
          <a href="https://www.scamwatch.gov.au" className="underline" rel="nofollow noopener" target="_blank">scamwatch.gov.au</a>
          ), and check anything suspicious with{" "}
          <Link href="/" className="underline">Ask Arthur</Link>. Full method:{" "}
          <Link href="/clone-watch/method" className="underline">how we detect clones</Link>.
        </p>
      </div>
    </>
  );
}
