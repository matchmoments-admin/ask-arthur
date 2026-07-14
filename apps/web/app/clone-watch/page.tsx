// Layer 0 clone-watch public page. Renders the last 7 days of operator-CONFIRMED
// NRD hits with factual-signal-only copy per docs/policy/draft-disclaimer-pack-v0.md
// Surface 5 principles.
//
// `noindex` for the first 7 days while v0 copy is unvetted. Sitemap
// excludes /clone-watch (see apps/web/app/sitemap.ts). Index-flip is a
// follow-up PR after #371 lawyer-vetted v1 copy lands — NOT this design change.
//
// Read path: service-role Supabase client (the table is service-role-only
// per v140 RLS); page renders server-side, never via browser supabase-js.
// The interactive domain grid is a client component that receives an
// already-safe, pre-decoded array (see CloneWatchDomainList).

import type { Metadata } from "next";
import Link from "next/link";
import { ShieldQuestion, ShieldCheck, Mail } from "lucide-react";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import FeatureCard from "@/components/FeatureCard";
import SampleReportForm from "@/components/SampleReportForm";
import CloneListRequestForm from "@/components/CloneListRequestForm";
import CloneWatchDomainList, {
  type CloneDomainItem,
} from "@/components/clone-watch/CloneWatchDomainList";

export const revalidate = 3600; // 1 hour ISR

export const metadata: Metadata = {
  title:
    "Clone-watch — newly-registered AU brand-pattern domains | Ask Arthur",
  description:
    "A daily list of newly-registered domains matching the lexical pattern of Australian retail brand names. Public-registry observations only.",
  // v0 page — noindex for the first 7 days while v0 copy is unvetted by
  // counsel. Flip via a follow-up PR after #371 lawyer pack returns.
  robots: { index: false, follow: false },
};

interface CloneAlertRow {
  id: number;
  candidate_domain: string;
  inferred_target_domain: string | null;
  signals: unknown;
  severity_tier: string;
  first_seen_at: string;
  source: string;
}

interface SignalEntry {
  type?: string;
  signal_type?: string;
  score?: number;
  evidence?: Record<string, unknown>;
}

async function getAlerts(): Promise<CloneAlertRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("shopfront_clone_alerts")
    .select(
      "id, candidate_domain, inferred_target_domain, signals, severity_tier, first_seen_at, source",
    )
    .is("target_shop_id", null)
    .eq("source", "nrd")
    .eq("alert_state", "open")
    // Only publish operator-CONFIRMED clones. Without this, the page rendered
    // every open NRD row regardless of triage outcome — verified 2026-05-29 to
    // be leaking 35 `fp` (false-positive, already cleared as NOT clones) and 1
    // `needs_investigation` row out of 47, i.e. publicly naming legitimate
    // businesses' domains as "possible clones". `noindex` keeps it out of
    // search but the page is still publicly reachable, so this is a
    // defamation/reputational fix, not cosmetic.
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    .gte("first_seen_at", since)
    .order("severity", { ascending: false })
    .order("first_seen_at", { ascending: false })
    .limit(100);
  return (data ?? []) as CloneAlertRow[];
}

interface PublicImpactSnapshot {
  window_days: number;
  candidates_total: number;
  tp_confirmed_total: number;
  netcraft_submits_total: number;
  brand_notifications_total: number;
  brands_protected: number;
}

interface PublicTakedownStats {
  window_days: number;
  takedowns_total: number;
  median_minutes: number;
}

async function getPublicImpact(): Promise<{
  impact: PublicImpactSnapshot;
  takedown: PublicTakedownStats | null;
} | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const [impactRes, takedownRes] = await Promise.all([
    supabase.rpc("clone_watch_public_impact", { p_days: 30 }),
    supabase.rpc("clone_watch_takedown_stats", { p_days: 30 }),
  ]);
  if (!Array.isArray(impactRes.data) || impactRes.data.length === 0) return null;
  const impact = impactRes.data[0] as PublicImpactSnapshot;
  const takedown =
    Array.isArray(takedownRes.data) && takedownRes.data[0]
      ? (takedownRes.data[0] as PublicTakedownStats)
      : null;
  return { impact, takedown };
}

interface EditionRow {
  period_month: string;
  total_domains: number;
  brand_count: number;
}

// The monthly editions (durable summary rows) — powers the "Monthly reports"
// index + latest-headline line on the pillar. Read via service client, same
// posture as getAlerts().
async function getEditions(): Promise<EditionRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("clone_watch_report_summary")
    .select("period_month, total_domains, brand_count")
    .order("period_month", { ascending: false })
    .limit(24);
  return (data ?? []) as EditionRow[];
}

function editionLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function firstSignal(signals: unknown): SignalEntry | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  const first = signals[0];
  if (typeof first !== "object" || first === null) return null;
  return first as SignalEntry;
}

// Map the first signal's type to the client grid's typeKey via a fixed
// whitelist — anything outside the curated vocabulary falls back to the
// generic "match" badge so attacker-influenced JSONB can't surface raw enum
// tokens inside the styled pill.
function typeKeyFor(signals: unknown): CloneDomainItem["typeKey"] {
  switch (firstSignal(signals)?.signal_type) {
    case "levenshtein":
      return "t";
    case "substring":
      return "b";
    case "confusable":
      return "l";
    default:
      return "match";
  }
}

// Dark "impact instrument" panel — aggregate-only, never names a specific
// candidate domain. Renders only when FF_SHOPFRONT_CLONE_OUTREACH=true AND
// there's at least one candidate in the window (a "0 candidates" panel reads
// as broken, not as quiet).
function PublicImpactPanel({
  impact,
  takedown,
}: {
  impact: PublicImpactSnapshot;
  takedown: PublicTakedownStats | null;
}) {
  const fmtMinutes = (m: number) =>
    m < 60 ? `${m} min` : `${(m / 60).toFixed(1)}h`;
  const perDay = Math.round(impact.candidates_total / (impact.window_days || 30));
  const pct =
    impact.candidates_total > 0
      ? Math.round((impact.netcraft_submits_total / impact.candidates_total) * 100)
      : 0;

  const tiles: Array<{ value: string; label: string; sub: string }> = [
    {
      value: impact.candidates_total.toLocaleString(),
      label: "Candidates surfaced",
      sub: `≈ ${perDay.toLocaleString()} new matches / day`,
    },
    {
      value: impact.brands_protected.toLocaleString(),
      label: "Brands protected",
      sub: "with a confirmed look-alike",
    },
    {
      value: impact.netcraft_submits_total.toLocaleString(),
      label: "Reported to Netcraft",
      sub: "forwarded to blocklists",
    },
    takedown && takedown.takedowns_total > 0
      ? {
          value: fmtMinutes(takedown.median_minutes),
          label: "Median time-to-takedown",
          sub: "from report to removal",
        }
      : {
          value: impact.brand_notifications_total.toLocaleString(),
          label: "Brand teams notified",
          sub: "aggregate-only policy",
        },
  ];

  return (
    <section
      aria-labelledby="impact-heading"
      className="mt-11 rounded-3xl bg-deep-navy p-8 md:p-9 text-white shadow-[0_24px_60px_-34px_rgba(15,39,68,0.55)]"
      style={{
        backgroundImage:
          "radial-gradient(120% 140% at 100% 0%, #17324f 0%, #001f3f 55%)",
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-7">
        <h2
          id="impact-heading"
          className="text-xs font-bold uppercase tracking-widest text-slate-300"
        >
          Last {impact.window_days} days · clone-watch impact
        </h2>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.22)]" />
          Updated daily
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-8">
        {tiles.map((t) => (
          <div key={t.label}>
            <div
              className="text-4xl md:text-5xl font-extrabold leading-none tracking-tight"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {t.value}
            </div>
            <div className="mt-3 text-sm font-semibold text-slate-100">{t.label}</div>
            <div className="mt-1 text-xs text-slate-400">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 pt-7 border-t border-white/10">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="text-sm text-slate-300">
            {impact.netcraft_submits_total.toLocaleString()} of{" "}
            {impact.candidates_total.toLocaleString()} candidates forwarded to
            community blocklists
          </span>
          <span className="text-sm font-bold">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              backgroundImage: "linear-gradient(90deg,#5aa2e6,#7fc3e8)",
            }}
          />
        </div>
        <p className="mt-5 text-xs leading-relaxed text-slate-400">
          Numbers are aggregate-only. We never publish which specific domains
          we&apos;ve reported. Reports go to community blocklist aggregators (so
          suspect domains get browser-blocked globally) and to the affected
          brand&apos;s security team.
        </p>
      </div>
    </section>
  );
}

export default async function CloneWatchPage() {
  const [alerts, impactBundle, editions] = await Promise.all([
    getAlerts(),
    featureFlags.shopfrontCloneOutreach
      ? getPublicImpact()
      : Promise.resolve(null),
    getEditions(),
  ]);
  const impact = impactBundle?.impact ?? null;
  const takedown = impactBundle?.takedown ?? null;
  const latest = editions[0] ?? null;

  const items: CloneDomainItem[] = alerts.map((a) => ({
    domain: a.candidate_domain,
    brand: a.inferred_target_domain,
    typeKey: typeKeyFor(a.signals),
    firstSeenAt: a.first_seen_at,
  }));

  return (
    <>
      {/* Hero */}
      <section className="text-center pt-4">
        <div className="inline-flex items-center gap-2.5 mb-6">
          <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-deep-navy">
            <ShieldQuestion size={15} className="text-white" />
          </span>
          <span className="text-[13px] font-bold uppercase tracking-[0.13em] text-deep-navy">
            Clone-watch · daily NRD sweep
          </span>
        </div>
        <h1 className="mx-auto max-w-[20ch] text-4xl md:text-5xl font-extrabold leading-[1.1] tracking-tight text-deep-navy">
          Newly-registered AU brand-pattern domains
        </h1>
        <p className="mx-auto mt-7 max-w-[60ch] text-lg text-gov-slate leading-relaxed">
          Each entry below is a domain registered in the last 7 days whose
          characters match the lexical pattern of an Australian brand on our
          reference list. These are factual observations from a public-registry
          sweep — <strong className="font-semibold text-deep-navy">not characterisations of the registrant or their intent.</strong>
        </p>
      </section>

      {/* Dark impact instrument panel */}
      {impact && impact.candidates_total > 0 && (
        <PublicImpactPanel impact={impact} takedown={takedown} />
      )}

      {/* Monthly reports — inline (no card), teal eyebrow */}
      {editions.length > 0 && (
        <section aria-labelledby="editions-heading" className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
            {latest && (
              <p className="text-base leading-relaxed text-gov-slate">
                <span
                  id="editions-heading"
                  className="mr-3.5 text-xs font-bold uppercase tracking-[0.13em] text-action-teal"
                >
                  Monthly reports
                </span>
                Latest edition —{" "}
                <strong className="font-bold text-deep-navy">
                  {editionLabel(latest.period_month)}
                </strong>
                : {latest.total_domains.toLocaleString()} lookalike domains
                across {latest.brand_count.toLocaleString()} brands.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-5">
              <Link
                href="/clone-watch/method"
                className="text-sm font-semibold text-deep-navy underline underline-offset-2"
              >
                How we measure this
              </Link>
              {latest && (
                <Link
                  href={`/clone-watch/${latest.period_month.slice(0, 7)}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-deep-navy px-4 py-2.5 text-sm font-bold text-white hover:bg-deep-navy/90 transition-colors"
                >
                  {editionLabel(latest.period_month)} <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </div>
          {editions.length > 1 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {editions.map((e) => (
                <li key={e.period_month}>
                  <Link
                    href={`/clone-watch/${e.period_month.slice(0, 7)}`}
                    className="inline-flex items-center rounded-full border border-deep-navy/25 px-3 py-1 text-xs font-medium text-deep-navy hover:bg-deep-navy/5"
                  >
                    {editionLabel(e.period_month)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Info cards — reuse the shared About feature-card shell */}
      <section className="mt-8 space-y-3">
        <FeatureCard
          icon={ShieldCheck}
          title="What this list is"
          titleAs="h3"
          description={
            <>
              A daily lexical match against newly-registered domains. We claim
              only that the domain string is{" "}
              <strong className="font-semibold text-deep-navy">characteristically similar</strong> to an
              Australian brand name by a deterministic measurement — we do{" "}
              <strong className="font-semibold text-deep-navy">not</strong> claim any listed domain is
              operated by a scammer or is hosting fraudulent content.
            </>
          }
        />
        <FeatureCard icon={Mail} title="If your brand appears here" titleAs="h3">
          <p className="text-sm text-gov-slate mt-1 leading-relaxed">
            Verify your shop on Ask Arthur, or request removal from the reference
            list — we respond to every request.
          </p>
          <Link
            href="/contact"
            className="mt-3 inline-block text-sm font-semibold text-action-teal underline underline-offset-2"
          >
            Contact our team →
          </Link>
        </FeatureCard>
        <SampleReportForm />
      </section>

      {featureFlags.cloneListRequest && (
        <section className="mt-3">
          <CloneListRequestForm />
        </section>
      )}

      {/* Interactive domain list */}
      <CloneWatchDomainList items={items} />

      {/* Methodology footnotes */}
      <section className="mt-14 grid gap-7 border-t border-slate-200 pt-9 md:grid-cols-3">
        <div>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.11em] text-deep-navy">
            Data source
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            Newly-registered domain (NRD) lists from whoisds.com (free public
            tier), filtered against a reference list of approximately 50
            Australian retail, bank, telco, and logistics brand names.
          </p>
        </div>
        <div>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.11em] text-deep-navy">
            What we have not done
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            We have not contacted the registrant, verified whether the domain
            resolves or serves content, or made any legal characterisation of
            the domain or its registrant.
          </p>
        </div>
        <div>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.11em] text-deep-navy">
            Updates
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            The list refreshes once per day. Entries fall off after 7 days. See{" "}
            <a href="/privacy" className="underline underline-offset-2">
              our privacy policy
            </a>{" "}
            for how we handle this data.
          </p>
        </div>
      </section>
    </>
  );
}
