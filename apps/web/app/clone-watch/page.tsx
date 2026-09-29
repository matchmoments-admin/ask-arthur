// Layer 0 clone-watch public page. Lists the last 7 days of CONFIRMED NRD
// lookalikes (triage tp_confirmed / tp_actioned — in prod almost all are the
// Netcraft auto lane's machine confirmation, classifier + live-site evidence,
// not a human's), each one reported to Netcraft. Founder decision 2026-09-28:
// say that plainly (public-impact.ts). Registrant copy follows
// docs/policy/draft-disclaimer-pack-v0.md Surface 5: no claim about who
// registered a domain or why.
//
// Freshness: ISR, revalidate = 3600 (below) — a change to the data or to v340
// shows within the hour; a deploy renders fresh.
//
// Indexing is gated on NEXT_PUBLIC_FF_CLONE_WATCH_PUBLIC (same flag as
// /clone-watch/method and /clone-watch/[period]). Copy hardened 2026-08-06
// (registrant correction path + review-accurate disclaimers); professional
// vetting of the disclaimer pack remains open as #371 but no longer gates
// indexing — founder decision, wayfinder #904/#908.
//
// Read path: service-role Supabase client (the table is service-role-only
// per v140 RLS); page renders server-side, never via browser supabase-js.
// The interactive domain grid is a client component that receives an
// already-safe, pre-decoded array (see CloneWatchDomainList).

import CoverageNote from "@/components/clone-watch/CoverageNote";
import type { Metadata } from "next";
import Link from "next/link";
import { ShieldQuestion, ShieldCheck, Mail } from "lucide-react";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import {
  formatMedianHours,
  MEDIAN_FLOOR,
} from "@/lib/clone-watch/duration-kpis";
import {
  blocklistTile,
  parseTakedownStats,
  type TakedownStats,
} from "@/lib/clone-watch/takedown-stats";
import {
  MATCHES_LABEL,
  parsePublicImpact,
  REPORTED_LABEL,
  REPORTING_STATEMENT,
  type PublicImpactSnapshot,
} from "@/lib/clone-watch/public-impact";
import { publicListBadge } from "@/lib/clone-watch/outcome-copy";
import { lookalikeDomains } from "@/lib/clone-watch/targeting-copy";
import {
  brandsMonitoredOn,
  monitoredBrandsPhrase,
} from "@/lib/clone-watch/brand-coverage";
import { readBrandCoverage } from "@/lib/clone-watch/brand-coverage-data";
import FeatureCard from "@/components/FeatureCard";
import SampleReportForm from "@/components/SampleReportForm";
import CloneListRequestForm from "@/components/CloneListRequestForm";
import SubscribeForm from "@/components/SubscribeForm";
import CloneWatchDomainList, {
  type CloneDomainItem,
} from "@/components/clone-watch/CloneWatchDomainList";

export const revalidate = 3600; // 1 hour ISR

export const metadata: Metadata = {
  title:
    "Clone-watch — newly-registered AU brand-pattern domains | Ask Arthur",
  description:
    "Newly-registered domains confirmed as lookalikes of brands Australians use, and reported to Netcraft for browser blocklisting. Updated daily.",
  robots: {
    index: featureFlags.cloneWatchPublic,
    follow: featureFlags.cloneWatchPublic,
  },
};

/** Only the columns the page renders (the old select also carried id,
 *  severity_tier, source and the whole signals array). */
interface CloneAlertRow {
  candidate_domain: string;
  inferred_target_domain: string | null;
  first_seen_at: string;
  lifecycle_state: string | null;
  offline_since: string | null;
  /** signals->0->>signal_type — the first signal's type, the only part read. */
  signal_type: string | null;
  /** Netcraft's own evidence for a taken_down row (publicListBadge). */
  netcraft_takedown_source: string | null;
  netcraft_url_state: string | null;
}

async function getAlerts(): Promise<CloneAlertRow[]> {
  const supabase = createServiceClient();
  if (!supabase) return [];
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("shopfront_clone_alerts")
    .select(
      "candidate_domain, inferred_target_domain, first_seen_at, lifecycle_state, offline_since, signal_type:signals->0->>signal_type, netcraft_takedown_source:submitted_to->netcraft->>takedown_at_source, netcraft_url_state:submitted_to->netcraft->>url_state",
    )
    .is("target_shop_id", null)
    .eq("source", "nrd")
    // Only publish CONFIRMED lookalikes. Without this, the page rendered
    // every open NRD row regardless of triage outcome — verified 2026-05-29 to
    // be leaking 35 `fp` (false-positive, already cleared as NOT clones) and 1
    // `needs_investigation` row out of 47, i.e. publicly naming legitimate
    // businesses' domains as "possible clones". This is a
    // defamation/reputational fix, not cosmetic.
    .in("triage_status", ["tp_confirmed", "tp_actioned"])
    // The page states that every listed domain was reported to Netcraft
    // (public-impact.ts REPORTING_STATEMENT). This filter is what makes that
    // true, not the observation that it happened to be (100% of confirmed
    // rows carried a submission on 2026-09-28).
    .not("submitted_to->netcraft", "is", null)
    // Open, blocklisted, or witnessed offline — so the row badge
    // (publicListBadge) can say what happened after we reported it. Until
    // 2026-09-28 this was alert_state='open' only, which hid every confirmed
    // lookalike the moment Netcraft actioned it. A `dormant` row WITHOUT
    // offline_since (v285's "gave up waiting for a scan") stays out: nothing
    // honest can be said about it.
    .or("alert_state.in.(open,taken_down),offline_since.not.is.null")
    .gte("first_seen_at", since)
    // Newest first, as the list's label says. It used to sort by severity
    // first while saying "newest first"; every NRD row is capped at the same
    // low severity tier, so the order was effectively arbitrary within a day.
    .order("first_seen_at", { ascending: false })
    .limit(100);
  return (data ?? []) as CloneAlertRow[];
}

/** Brands on the watchlist today, or null when the coverage read failed. */
async function getMonitoredBrands(): Promise<number | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  const rows = await readBrandCoverage(supabase, "clone-watch-page");
  if (!rows) return null;
  return brandsMonitoredOn(rows, new Date().toISOString());
}

interface PublicVendorGapStats {
  window_days: number;
  decline_to_weaponise_n: number;
  decline_to_weaponise_median_hours: number | null;
  weaponise_to_refile_n: number;
  weaponise_to_refile_median_hours: number | null;
  refile_to_takedown_n: number;
  refile_to_takedown_median_hours: number | null;
  full_loop_n: number;
  full_loop_median_hours: number | null;
}

async function getPublicImpact(): Promise<{
  impact: PublicImpactSnapshot;
  takedown: TakedownStats | null;
  vendorGap: PublicVendorGapStats | null;
} | null> {
  const supabase = createServiceClient();
  if (!supabase) return null;
  // Vendor-gap window is 90 days (not 30): re-file loops are rare enough that
  // a 30-day window would sit under the n>=5 median floor most months.
  const [impactRes, takedownRes, vendorGapRes] = await Promise.all([
    supabase.rpc("clone_watch_public_impact", { p_days: 30 }),
    supabase.rpc("clone_watch_takedown_stats", { p_days: 30 }),
    supabase.rpc("clone_watch_vendor_gap_stats", { p_days: 90 }),
  ]);
  const impact = parsePublicImpact(impactRes.data);
  if (!impact) return null;
  const takedown = parseTakedownStats(takedownRes.data);
  const vendorGap =
    Array.isArray(vendorGapRes.data) && vendorGapRes.data[0]
      ? (vendorGapRes.data[0] as PublicVendorGapStats)
      : null;
  return { impact, takedown, vendorGap };
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

// Map the first signal's type to the client grid's typeKey via a fixed
// whitelist — anything outside the curated vocabulary falls back to the
// generic "match" badge so attacker-influenced JSONB can't surface raw enum
// tokens inside the styled pill.
function typeKeyFor(signalType: string | null): CloneDomainItem["typeKey"] {
  switch (signalType) {
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

// The vendor-gap clock: how long a "no threats found" grading holds before a
// clone weaponises, and how fast the re-report loop closes. Aggregate-only;
// omitted entirely when no leg has data (all-zero reads as broken).
function VendorGapStrip({ vendorGap }: { vendorGap: PublicVendorGapStats }) {
  const legs: Array<{ n: number; median: number | null; label: string }> = [
    {
      n: vendorGap.decline_to_weaponise_n,
      median: vendorGap.decline_to_weaponise_median_hours,
      // "classified", not "observed": weaponised_at can come from a Safe
      // Browsing / VirusTotal reputation hit without a rendered scan (the
      // reputation-fallback path) — the F1 email uses the same honest verb.
      label: "from a vendor “no threats found” grading to the same domain being classified as live phishing",
    },
    {
      n: vendorGap.weaponise_to_refile_n,
      median: vendorGap.weaponise_to_refile_median_hours,
      label: "from the live-phishing classification to re-filing the domain with fresh evidence",
    },
    {
      n: vendorGap.refile_to_takedown_n,
      median: vendorGap.refile_to_takedown_median_hours,
      label: "from the evidence re-filing to a witnessed Netcraft malicious classification (blocklisting)",
    },
  ];
  if (legs.every((l) => l.n === 0)) return null;

  return (
    <div className="mt-8 pt-7 border-t border-white/10">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300 mb-4">
        Last {vendorGap.window_days} days · the vendor-gap clock
      </h3>
      <div className="space-y-3">
        {legs
          .filter((l) => l.n > 0)
          .map((l) => (
            <div key={l.label} className="flex items-baseline gap-3">
              <span
                className="shrink-0 text-xl font-extrabold tracking-tight"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {l.n >= MEDIAN_FLOOR && l.median != null
                  ? `median ${formatMedianHours(l.median)}`
                  : `${l.n} ${l.n === 1 ? "domain" : "domains"}`}
              </span>
              <span className="text-xs leading-relaxed text-slate-400">
                {l.label}
                {l.n >= MEDIAN_FLOOR && l.median != null
                  ? ` (n=${l.n})`
                  : " — median withheld, sample too small"}
              </span>
            </div>
          ))}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        Phishing classifications come from urlscan.io renders or Safe
        Browsing / VirusTotal reputation; their timestamps are quantised by
        our recheck and retrieve cycles. Blocklisting timings count only
        transitions witnessed in the vendor&apos;s own per-URL gradings; a
        blocklisted site may still be online. Only confirmed lookalikes are
        counted.
      </p>
    </div>
  );
}

// Dark "impact instrument" panel — aggregate numbers (the confirmed lookalikes
// are named in the list further down). Renders only when
// FF_SHOPFRONT_CLONE_OUTREACH=true AND there's at least one match in the
// window (a "0 matches" panel reads as broken, not as quiet). Labels and the
// reporting sentence come from public-impact.ts, shared with /hub.
function PublicImpactPanel({
  impact,
  takedown,
  vendorGap,
}: {
  impact: PublicImpactSnapshot;
  takedown: TakedownStats | null;
  vendorGap: PublicVendorGapStats | null;
}) {
  // "Taken down" in our data means Netcraft CLASSIFIED the URL malicious
  // (browser blocklists act on that) — not that the site went offline. Until
  // #1234 this tile subtracted OUR submitted_at from Netcraft's classification
  // time; Netcraft classifies inside the seconds our stamp trails its receipt,
  // so it read "0 min" with a fastest of −2 min. It now shows detection →
  // blocklisting: our urlscan witness of live phishing (weaponised_at) to
  // Netcraft's own classification time. Hour-scale, so the clocks' seconds of
  // skew cannot flip its sign; a site Netcraft had blocked before we saw it is
  // counted apart in SQL, never averaged in. Only with a sample worth a median.
  // The wording (sample label + "most of this is our cadence") lives in ONE
  // place: takedown-stats.ts blocklistTile.
  const blocklist = blocklistTile(takedown, MEDIAN_FLOOR);
  const perDay = Math.round(impact.candidates_total / (impact.window_days || 30));
  const pct =
    impact.candidates_total > 0
      ? Math.round((impact.netcraft_submits_total / impact.candidates_total) * 100)
      : 0;

  const tiles: Array<{ value: string; label: string; sub: string }> = [
    {
      value: impact.candidates_total.toLocaleString(),
      label: MATCHES_LABEL,
      sub: `≈ ${perDay.toLocaleString()} a day · false positives removed`,
    },
    {
      value: impact.brands_protected.toLocaleString(),
      label: "Brands protected",
      sub: "with a confirmed look-alike",
    },
    {
      value: impact.netcraft_submits_total.toLocaleString(),
      label: REPORTED_LABEL,
      sub: "forwarded to blocklists",
    },
    blocklist ?? {
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
            {impact.candidates_total.toLocaleString()} brand-name matches
            reported to Netcraft
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
          {REPORTING_STATEMENT}
        </p>
        {blocklist && (
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{blocklist.note}</p>
        )}
      </div>

      {vendorGap && <VendorGapStrip vendorGap={vendorGap} />}
    </section>
  );
}

export default async function CloneWatchPage() {
  const [alerts, impactBundle, editions, monitoredBrands] = await Promise.all([
    getAlerts(),
    featureFlags.shopfrontCloneOutreach
      ? getPublicImpact()
      : Promise.resolve(null),
    getEditions(),
    getMonitoredBrands(),
  ]);
  const impact = impactBundle?.impact ?? null;
  const takedown = impactBundle?.takedown ?? null;
  const vendorGap = impactBundle?.vendorGap ?? null;
  const latest = editions[0] ?? null;
  // monitoredBrandsPhrase is the one wording of the count ("290+"); null (a
  // failed coverage read) drops the number rather than print a stale literal.
  const brandsPhrase = monitoredBrandsPhrase(monitoredBrands);

  const items: CloneDomainItem[] = alerts.map((a) => ({
    domain: a.candidate_domain,
    brand: a.inferred_target_domain,
    typeKey: typeKeyFor(a.signal_type),
    firstSeenAt: a.first_seen_at,
    badge: publicListBadge({
      lifecycleState: a.lifecycle_state,
      offlineSince: a.offline_since,
      netcraftTakedownSource: a.netcraft_takedown_source,
      netcraftUrlState: a.netcraft_url_state,
    }),
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
        <CoverageNote className="mx-auto mt-4 max-w-[60ch]" />
        <p className="mx-auto mt-7 max-w-[60ch] text-lg text-gov-slate leading-relaxed">
          Each entry below is a domain registered in the last 7 days that
          imitates a brand on our watchlist and that we have{" "}
          <strong className="font-semibold text-deep-navy">confirmed as a lookalike</strong>{" "}
          and reported to Netcraft, whose verdicts feed browser blocklists. We
          don&apos;t know who registered these domains or why, and we make no
          claim about the people behind them.
        </p>
      </section>

      {/* Dark impact instrument panel */}
      {impact && impact.candidates_total > 0 && (
        <PublicImpactPanel impact={impact} takedown={takedown} vendorGap={vendorGap} />
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
                : {lookalikeDomains(latest.total_domains)} across{" "}
                {latest.brand_count.toLocaleString()} brands.
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
              Every day we match newly-registered domains against the brand
              names on our watchlist. A match is listed here only once it is{" "}
              <strong className="font-semibold text-deep-navy">confirmed as a lookalike</strong>: our
              clone classifier judged the name a copy of the brand and a scan of
              the live site or a threat-reputation service flagged it as
              phishing, or one of our team confirmed it. We report every listed domain to Netcraft. Matches
              that are not confirmed are counted in the numbers above but{" "}
              <strong className="font-semibold text-deep-navy">never listed</strong>.
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
        <FeatureCard icon={Mail} title="If you registered one of these domains" titleAs="h3">
          <p className="text-sm text-gov-slate mt-1 leading-relaxed">
            Inclusion here means we confirmed the domain as a lookalike of a
            brand and reported it to Netcraft. It is{" "}
            <strong className="font-semibold text-deep-navy">not a finding about you</strong>{" "}
            — we don&apos;t know who registered it or why. If you believe your
            domain is listed in error, or you want to explain its purpose,
            contact us and we will review the entry — corrections and removals
            are actioned on every substantiated request.
          </p>
          <Link
            href="/contact"
            className="mt-3 inline-block text-sm font-semibold text-action-teal underline underline-offset-2"
          >
            Request a review →
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

      {/* Newsletter capture — capture-before-content (#933 item 4) */}
      <section className="mt-14 max-w-md">
        <h3 className="text-deep-navy text-sm font-bold uppercase tracking-wider mb-1">
          Get weekly scam alerts
        </h3>
        <p className="text-slate-500 text-sm mb-3">
          Lookalike domains, fake stores, the week&rsquo;s scams — in your
          inbox every Monday.
        </p>
        <SubscribeForm variant="inline" source="clone_watch" />
      </section>

      {/* Methodology footnotes */}
      <section className="mt-14 grid gap-7 border-t border-slate-200 pt-9 md:grid-cols-3">
        <div>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.11em] text-deep-navy">
            Data source
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            Newly-registered domain (NRD) lists from whoisds.com (free public
            tier), matched against a watchlist of{" "}
            {brandsPhrase ? `${brandsPhrase} ` : ""}brands Australians use —
            retail, banks, telcos, logistics and more.
          </p>
        </div>
        <div>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.11em] text-deep-navy">
            What we have not done
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            Entries are machine-classified (name-similarity match, an automated
            clone classifier, and a live-site scan or reputation check);
            operators review exceptions. That process does not determine who registered
            the domain or why: we have not contacted registrants, and we make no
            legal characterisation of any domain or its registrant.
          </p>
        </div>
        <div>
          <div className="mb-2.5 text-xs font-bold uppercase tracking-[0.11em] text-deep-navy">
            Updates
          </div>
          <p className="text-[13.5px] leading-relaxed text-slate-500">
            The page refreshes at most hourly and the sweep runs once a day.
            Entries fall off 7 days after the domain was first seen. See{" "}
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
