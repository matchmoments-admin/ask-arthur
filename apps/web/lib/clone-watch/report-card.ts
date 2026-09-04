/**
 * The report card, as a PURE fold over already-fetched rows.
 *
 * Everything the monthly edition publishes is decided here — the KPI rollups,
 * the AU-vs-global split, the month-on-month gate, the trend verdicts and the
 * spotlight ladder. None of it touches Supabase.
 *
 * WHY THE SEAM IS HERE. `getCloneWatchReportCard` used to open with
 * `createServiceClient()`, so nothing downstream of it could be computed from
 * fixtures and the card had no test at all — while the caption's consumers of
 * its output were pinned nine ways from hand-built fixtures. Worse, a single
 * published edition was assembled from three-to-five INDEPENDENT reads of a
 * table the reconciler mutates daily: the slide export hits prod once per
 * slide, the caption recomputes in the GH runner, and the publish write-back
 * recomputes a third time AFTER an unbounded human approval gate. The caption
 * module claims it "always matches the carousel"; that was true per-read and
 * false across the pipeline.
 *
 * With the fold separated from the read, `loadCardInputs` runs once and every
 * surface folds the same bytes.
 *
 * @see report-card-data.ts — the I/O half (four reads, no computation)
 * @see spotlight.ts — the ladder, extracted so it can be tested directly
 */
import { AU_BRAND_WATCHLIST } from "@askarthur/shopfront-glue";
import {
  summariseCampaigns,
  type CampaignSummary,
} from "@/lib/clone-watch/campaign-summary";
import {
  computeDurationKpis,
  registrarWeaponisation,
  tldWeaponisation,
  type DurationKpis,
  type RegistrarWeaponisationRow,
} from "@/lib/clone-watch/duration-kpis";
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import {
  aggregateClonesByDomain,
  buildRegistrarRollup,
  type CloneBrandMetrics,
} from "@/lib/clone-watch/clone-metrics";
import {
  computeTargetingIntel,
  computeTargetingIntelByBrand,
  type HostingSummary,
  type InfrastructureCluster,
  type Mix,
  type TargetingIntel,
} from "@/lib/clone-watch/targeting-intelligence";
import {
  brandsCoveredForMonth,
  classifyTrend,
  summariseTrendExclusions,
  type BrandCoverage,
  type TrendVerdict,
} from "@/lib/clone-watch/brand-coverage";
import { rollupRegistrars } from "@/lib/clone-watch/registrar-canonical";
import { SUPER_FUND_DOMAINS } from "@/lib/clone-watch/brand-display";
import { pickSpotlight, type Spotlight } from "@/lib/clone-watch/spotlight";
import type { MonthWindow } from "@/lib/clone-watch/month-window";

export type { Spotlight };
export type SpotlightKind = Spotlight["kind"];

/**
 * First month with a FULL month of clone-watch coverage. Clone Watch launched
 * 2026-05-24, so May 2026 holds only ~1 week of detections — comparing a full
 * month against that launch stub would overstate month-on-month growth. We only
 * surface a MoM delta when BOTH the report month and its prior month are at or
 * after this threshold, so the first honest comparison is July-2026-vs-June-2026.
 * Editions before that render a "first full month tracked" baseline instead.
 */
const FIRST_FULL_MONTH = "2026-06"; // YYYY-MM

export interface RankedBrand {
  brand: string;
  clones: number;
}

/**
 * AU superannuation-fund brand domains on the clone watchlist. Used to surface
 * the "super fund" editorial angle when a fund ranks among the most-impersonated
 * AU brands (retirement savings as a front-line target). Keyed by full domain
 * so the ambiguous ones ("rest", "aware") can't false-match. Extend as funds are
 * added to the watchlist.
 */

export interface SuperFundSpotlight {
  /** The impersonated fund's domain, e.g. "hesta.com.au". */
  brand: string;
  clones: number;
  /** 1-based rank among AU brands (1 = most-targeted AU brand). */
  auRank: number;
}

/** Which story earned slide 3 this month. The ladder exists because a
 *  category-only rule repeats: HESTA was the top super fund in both June and
 *  July 2026, so it took the spotlight twice while the month's actual news
 *  (Apple 42→85, Google 21→54, two first-time entrants) went untold. */
export interface MonthOverMonth {
  /** Whether a fair MoM comparison exists (both months fully tracked). When
   *  false, the card shows a baseline framing rather than a misleading delta. */
  available: boolean;
  /** Human label for the prior month, e.g. "May 2026". */
  priorLabel: string;
  priorTotal: number;
  priorBrands: number;
  /** current.total - prior.total (can be negative). */
  totalDelta: number;
  /** Rounded percentage change vs prior; null when prior total is 0. */
  totalPct: number | null;
  brandsDelta: number;
}

export interface CloneWatchReportCard {
  /** ISO month start, e.g. "2026-06-01". */
  periodMonth: string;
  /** Human label, e.g. "June 2026". */
  periodLabel: string;
  total: number;
  brands: number;
  /**
   * How many brands we were monitoring FOR THIS MONTH — the number the caption's
   * methodology line quotes.
   *
   * Read from `brand_coverage_history` rather than `AU_BRAND_WATCHLIST.length`,
   * because the watchlist is today's and a card can be built for any past month
   * (`--month=`, and the export workflow's dispatch input). Quoting the live
   * length restates a past month's methodology with a number that was not true
   * then — and it only ever grows, so a re-export overstates. Falls back to the
   * live length when coverage cannot be read, which is the old behaviour.
   */
  watchlistSize: number;
  kpis: {
    reportedToNetcraft: number;
    likelyPhishing: number;
    parkedForSale: number;
    /**
     * The rest of the classification axis. `likely_phishing` + `parked_for_sale`
     * are two of FIVE mutually-exclusive buckets that partition the cohort, and
     * showing only those two left the slide's numbers unable to reconcile
     * against its own headline. These three complete it:
     *   neutral      — resolved, nothing auto-classified, awaiting human review
     *   unresolved   — we scanned it and the page didn't render
     *   unclassified — we never obtained a verdict at all (the stranded cohort)
     */
    neutral: number;
    unresolved: number;
    unclassified: number;
    /** Netcraft actioned (lifecycle taken_down) — populated by the PR3.1 reconciler. */
    takenDown: number;
    /** Netcraft declined (still live/parked) — the "unactioned lookalike" headline. */
    declined: number;
    /** We filed a report_issue to force a re-review. */
    escalated: number;
    /** Currently serving active phishing (lifecycle weaponised). */
    weaponised: number;
    /** Weaponised AND previously Netcraft-declined — the only subset for which
     *  the "graded no-threat, later flipped" story is provable (see
     *  lib/clone-watch/outcome-copy.ts honesty rules). */
    weaponisedAfterDecline: number;
    /** Escalated → then taken down ("we forced it through"). Subset of takenDown. */
    reTakenDown: number;
  };
  topAuBrands: RankedBrand[];
  globalBrands: RankedBrand[];
  topRegistrars: Array<{ registrar: string; clones: number }>;
  /** Rows whose registrar is redacted/unknown - reported for honesty, excluded
   *  from the leaderboard (rendered as a "N WHOIS-hidden" footnote). */
  unknownRegistrarCount: number;
  /** Live month-on-month comparison vs the prior calendar month. Computed by a
   *  second fetch+aggregate over the prior window (no dependency on the durable
   *  clone_watch_report_summary snapshot — that lands in WS3). Currently unrendered
   *  (the scale/MoM slide was cut from the 7-deck for the June baseline); retained
   *  because the recurring-automation build re-introduces a conditional MoM slide
   *  once there's an honest delta (July-vs-June onward). */
  mom: MonthOverMonth;
  /**
   * Per-brand month-over-month verdicts + the exclusion counts the published
   * caveat is built from (#1075). Computed live here rather than read back from
   * clone_watch_monthly_brand_stats, so the admin preview and the published
   * post cannot disagree, and so the cron has no write-then-read ordering
   * hazard with its own later step.
   */
  brandTrends: BrandTrendGate;
  /**
   * Cohort-level targeting characterisation — the shape half of the report
   * (tactic / TLD / hosting / clusters). Computed from the same rows as every
   * other figure on the card, so slide and caption cannot disagree.
   */
  targeting: TargetingIntel;
  /** The highest-ranked AU super fund among the impersonated brands, if any —
   *  powers the "super fund" spotlight slide. null when no watchlisted fund
   *  appears this month (the slide falls back to the evergreen "why it works"). */
  superFund: SuperFundSpotlight | null;
  /** Slide 3's subject, chosen by news value and never repeating last month's
   *  (see SpotlightKind). Falls back to "globals" when nothing else qualifies. */
  spotlight: Spotlight;
  /** The vendor-gap clock over THIS month's first_seen_at cohort. Cohort
   *  medians — expected to differ from the rolling-event-window
   *  clone_watch_vendor_gap_stats RPC that feeds the public panel. */
  durations: DurationKpis;
  /** Which registrars' clones weaponise, and how fast (canonicalised;
   *  explicit Unknown bucket rendered for honesty). */
  registrarWeaponisation: RegistrarWeaponisationRow[];
  /** Per-TLD weaponisation counts (card-render only, not persisted). */
  tldWeaponisation: Array<{ tld: string; weaponised: number }>;
  /** Coordinated campaigns (>=2 lookalikes sharing an actor fingerprint, v235)
   *  over this month's cohort — the "one actor, N of your domains" story.
   *  Empty until FF_CLONE_CAMPAIGNS has stamped campaign_key on the cohort. */
  campaigns: CampaignSummary;
}

/** Australian government domain (.gov.au, incl. state variants like .vic.gov.au). */
function isGovDomain(domain: string): boolean {
  return domain.toLowerCase().includes(".gov.");
}

/**
 * AU brand = an Australian TLD, excluding government (we rank "brands").
 *
 * NOTE: this is a TLD heuristic, so an AU company on a .com (e.g. Stake /
 * hellostake.com) is classified GLOBAL, and a multinational's .com.au shopfront
 * is classified AU. The clone watchlist has no is-AU flag to key off, so the
 * operator curates edge cases at approval time. Good enough for the ranking;
 * the total/brands counts are unaffected.
 */
function isAuBrand(domain: string): boolean {
  const d = domain.toLowerCase();
  return d.endsWith(".au") && !isGovDomain(d);
}

function sumClassification(
  byBrand: Map<string, CloneBrandMetrics>,
  cls: string,
): number {
  let n = 0;
  for (const m of byBrand.values()) n += m.byClassification[cls] ?? 0;
  return n;
}

/** Sum a numeric lifecycle metric across all brands. */
function sumMetric(
  byBrand: Map<string, CloneBrandMetrics>,
  key:
    | "takenDown"
    | "declined"
    | "escalated"
    | "weaponised"
    | "weaponisedAfterDecline"
    | "reTakenDown",
): number {
  let n = 0;
  for (const m of byBrand.values()) n += m[key] ?? 0;
  return n;
}

export interface BrandTrendGate {
  /** Brands whose movement may be published, largest rise first. */
  claimable: Array<{ brand: string; clones: number; priorClones: number; delta: number; pct: number | null }>;
  /** Why the rest were withheld — the caveat's numbers. */
  excluded: ReturnType<typeof summariseTrendExclusions>;
  /**
   * False when coverage could not be read at all. The gate fails closed: no
   * trend claim may be published from a card whose coverage basis is unknown.
   */
  publishable: boolean;
}

export interface BrandTrendRow {
  brand: string;
  is_au: boolean;
  clones: number;
  reported_to_netcraft: number;
  likely_phishing: number;
  parked: number;
  taken_down: number;
  declined: number;
  escalated: number;
  weaponised: number;
  // ── targeting characterisation (v296) ──────────────────────────────────
  // Shape rather than volume: how the names were built, where they were
  // hosted, what infrastructure they shared. Each jsonb carries its own
  // denominator and unknown bucket (see targeting-intelligence.ts `Mix`)
  // because the source fields have very different coverage.
  deliberate_clones: number;
  tactic_mix: Mix;
  intent_mix: Mix;
  tld_mix: Mix;
  hosting_mix: HostingSummary;
  clusters: InfrastructureCluster[];
  fingerprinted_clones: number;
  largest_cluster: number;
}
export interface RegistrarTrendRow {
  registrar: string;
  clones: number;
  /** Clones of this registrar that weaponised this month (v231 column). */
  weaponised: number;
  /** Median days first_seen_at → weaponised_at; null when weaponised = 0. */
  median_days_to_weaponise: number | null;
}
export interface CloneWatchTrendRows {
  periodMonth: string; // "YYYY-MM-01"
  brandRows: BrandTrendRow[];
  registrarRows: RegistrarTrendRow[];
}

/** Sum detected clones + distinct brand count across a per-brand metric map. */
function totalsOf(byBrand: Map<string, CloneBrandMetrics>): {
  total: number;
  brands: number;
} {
  let total = 0;
  for (const m of byBrand.values()) total += m.detected;
  return { total, brands: byBrand.size };
}


/**
 * Everything the fold needs. Four reads produce this; see `loadCardInputs`.
 */
export interface CardInputs {
  window: MonthWindow;
  priorWindow: MonthWindow;
  /** Current month, already through `applyCohortRules`. */
  rows: CloneAlertRow[];
  /** Prior month, same treatment — the month-on-month comparison. */
  priorRows: CloneAlertRow[];
  /**
   * EVERY coverage row, not merged: several brands can share one brand_domain
   * and a re-added brand has two disjoint rows.
   *
   * `null` means the read FAILED, which is NOT the same as `[]` (the table is
   * empty). Both suppress every trend claim, but only one of them is a bug, and
   * collapsing them is how a degraded read quietly becomes "no exclusions".
   */
  coverage: BrandCoverage[] | null;
  /** What last month's edition led with, so the ladder cannot repeat it. */
  priorSpotlightBrand: string | null;
  /**
   * Used for `watchlistSize` when coverage yields nothing. An explicit input
   * rather than a module-level read of `AU_BRAND_WATCHLIST.length`, because an
   * ambient value makes the fold non-deterministic across processes — and
   * determinism is the entire point of computing the card once.
   */
  watchlistFallbackSize?: number;
}


/** The published card: one pure fold over `CardInputs`. */
export function buildReportCard(input: CardInputs): CloneWatchReportCard {
  const { window, priorWindow: prevWin, rows, priorRows, coverage } = input;
  const { periodMonth, label } = window;
  const priorSpotlightBrand = input.priorSpotlightBrand;

  const byBrand = aggregateClonesByDomain(rows);
  const priorByBrand = aggregateClonesByDomain(priorRows);

  let total = 0;
  let reportedToNetcraft = 0;
  for (const m of byBrand.values()) {
    total += m.detected;
    reportedToNetcraft += m.netcraftReported;
  }
  const prior = totalsOf(priorByBrand);

  // Coverage keyed by brand domain — the key byBrand uses. ALL rows per domain,
  // never a merged window (see brandsCoveredForMonth).
  const coverageReadOk = coverage !== null;
  const coverageByBrand = new Map<string, BrandCoverage[]>();
  for (const entry of coverage ?? []) {
    const bucket = coverageByBrand.get(entry.brandDomain);
    if (bucket) bucket.push(entry);
    else coverageByBrand.set(entry.brandDomain, [entry]);
  }

  // Only a fair comparison when BOTH months are fully tracked (see
  // FIRST_FULL_MONTH); otherwise the card renders a baseline, not a delta.
  const momAvailable =
    periodMonth.slice(0, 7) >= FIRST_FULL_MONTH &&
    prevWin.periodMonth.slice(0, 7) >= FIRST_FULL_MONTH &&
    prior.total > 0;
  // Brands monitored for the WHOLE of the reported month — the methodology
  // line's denominator, correct for a backfilled month rather than for today.
  const brandsMonitoredThisMonth = new Set<string>();
  for (const rows of coverageByBrand.values()) {
    for (const b of brandsCoveredForMonth(rows, periodMonth.slice(0, 7))) {
      brandsMonitoredThisMonth.add(b);
    }
  }
  // `watchlistFallbackSize` first: the whole point of the field is that a
  // re-export of a past edition must not restate that month's methodology with
  // TODAY's watchlist. It was declared, documented and tested, and then never
  // read here — so the property it promises did not hold. AU_BRAND_WATCHLIST is
  // the last resort, for callers that pass nothing.
  const watchlistSize =
    brandsMonitoredThisMonth.size ||
    input.watchlistFallbackSize ||
    AU_BRAND_WATCHLIST.length;

  const priorYm = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00Z`);
  priorYm.setUTCMonth(priorYm.getUTCMonth() - 1);
  const priorPeriod = priorYm.toISOString().slice(0, 7);
  const verdicts: TrendVerdict[] = [];
  const verdictByBrand = new Map<string, TrendVerdict>();
  const claimable: BrandTrendGate["claimable"] = [];
  for (const [brand, m] of byBrand) {
    const priorClones = priorByBrand.get(brand)?.detected ?? 0;
    const v = classifyTrend({
      currentClones: m.detected,
      priorClones,
      currentMonth: periodMonth.slice(0, 7),
      priorMonth: priorPeriod,
      coverage: coverageByBrand.get(brand),
    });
    verdicts.push(v);
    verdictByBrand.set(brand, v);
    if (v.kind === "claimable" && v.delta !== 0) {
      claimable.push({ brand, clones: m.detected, priorClones, delta: v.delta, pct: v.pct });
    }
  }
  claimable.sort((a, b) => b.delta - a.delta || a.brand.localeCompare(b.brand));

  const brandTrends: BrandTrendGate = {
    claimable,
    excluded: summariseTrendExclusions(verdicts),
    publishable: coverageReadOk && coverageByBrand.size > 0,
  };

  const mom: MonthOverMonth = {
    available: momAvailable,
    priorLabel: prevWin.label,
    priorTotal: prior.total,
    priorBrands: prior.brands,
    totalDelta: total - prior.total,
    totalPct:
      prior.total > 0
        ? Math.round(((total - prior.total) / prior.total) * 100)
        : null,
    brandsDelta: byBrand.size - prior.brands,
  };

  // Registrar leaderboard: reuse the digest's rollup (single source of truth),
  // then canonicalise + drop the Unknown bucket. buildRegistrarRollup already
  // sums byRegistrar across brands; rollupRegistrars accepts its {registrar,
  // clones} row shape directly.
  const { rows: rawRegistrars, unknownCount } = buildRegistrarRollup(byBrand);
  const topRegistrars = rollupRegistrars(rawRegistrars).slice(0, 6);

  const ranked = [...byBrand.entries()]
    .map(([brand, m]) => ({ brand, clones: m.detected }))
    .sort((a, b) => b.clones - a.clones || a.brand.localeCompare(b.brand));

  // Super-fund spotlight: the highest-ranked super fund, with its rank among
  // Australian brands. Super funds ARE Australian brands even on a .com (e.g.
  // australiansuper.com) — which the .au TLD heuristic would classify "global"
  // and hide from the spotlight — so rank against AU brands PLUS watchlisted
  // funds. Ranked-desc order means findIndex picks the most-targeted fund.
  const isFund = (d: string) => SUPER_FUND_DOMAINS.has(d.toLowerCase());
  const auOrFund = ranked.filter((r) => isAuBrand(r.brand) || isFund(r.brand));
  const sfIdx = auOrFund.findIndex((r) => isFund(r.brand));
  const superFund: SuperFundSpotlight | null =
    sfIdx >= 0
      ? {
          brand: auOrFund[sfIdx].brand,
          clones: auOrFund[sfIdx].clones,
          auRank: sfIdx + 1,
        }
      : null;

  // The ladder itself lives in spotlight.ts — it is the feature's editorial
  // brain and needed to be reachable by a test without a Supabase client.
  const spotlight = pickSpotlight({
    auOrFund,
    priorClonesOf: (brand) => priorByBrand.get(brand)?.detected ?? 0,
    // BOTH comparative rungs must pass the coverage gate, not merely the volume
    // thresholds. Without this the gate is decorative: it was fully tested, its
    // caveat was printed in the caption, and the publisher beside it applied
    // none of it. The Ordinary (1 -> 11) clears priorClones > 0 and
    // delta >= MOVER_MIN_DELTA, so it would have published as "the month's
    // sharpest riser" with the gate's own exclusion caveat printed underneath.
    isClaimable: (brand) =>
      brandTrends.publishable &&
      verdictByBrand.get(brand)?.kind === "claimable",
    priorSpotlightBrand,
    momAvailable,
    superFund,
  });

  return {
    periodMonth,
    periodLabel: label,
    total,
    brands: byBrand.size,
    watchlistSize,
    kpis: {
      reportedToNetcraft,
      likelyPhishing: sumClassification(byBrand, "likely_phishing"),
      parkedForSale: sumClassification(byBrand, "parked_for_sale"),
      neutral: sumClassification(byBrand, "neutral"),
      unresolved: sumClassification(byBrand, "unresolved"),
      unclassified: sumClassification(byBrand, "unclassified"),
      takenDown: sumMetric(byBrand, "takenDown"),
      declined: sumMetric(byBrand, "declined"),
      escalated: sumMetric(byBrand, "escalated"),
      weaponised: sumMetric(byBrand, "weaponised"),
      weaponisedAfterDecline: sumMetric(byBrand, "weaponisedAfterDecline"),
      reTakenDown: sumMetric(byBrand, "reTakenDown"),
    },
    // Gov domains are excluded from BOTH public rankings (they're neither
    // consumer "brands" nor global); they still count toward total/brands.
    topAuBrands: ranked.filter((r) => isAuBrand(r.brand)).slice(0, 8),
    globalBrands: ranked
      .filter((r) => !isAuBrand(r.brand) && !isGovDomain(r.brand))
      .slice(0, 5),
    topRegistrars,
    unknownRegistrarCount: unknownCount,
    mom,
    brandTrends,
    targeting: computeTargetingIntel(rows),
    superFund,
    spotlight,
    // The vendor-gap clock + weaponisation cuts, computed over the SAME
    // FP-filtered cohort rows the aggregate came from (one fetch, no drift).
    durations: computeDurationKpis(rows),
    registrarWeaponisation: registrarWeaponisation(rows),
    tldWeaponisation: tldWeaponisation(rows),
    // Coordinated-campaign clustering over the same cohort (single fetch, no
    // drift). Empty until campaign_key is populated (FF_CLONE_CAMPAIGNS).
    campaigns: summariseCampaigns(rows),
  };
}

/**
 * Full per-brand + per-registrar rows for a month (NOT just the top-N the
 * report card keeps). Folds the SAME rows buildReportCard does, so trend rows
 * sum back to the summary card by construction rather than by two functions
 * agreeing. Written to the v193 trend tables by the monthly snapshot cron.
 */
export function buildTrendRows(
  input: Pick<CardInputs, "window" | "rows">,
): CloneWatchTrendRows {
  const { periodMonth } = input.window;
  const rows = input.rows;
  const byBrand = aggregateClonesByDomain(rows);

  // Per-brand characterisation over the SAME already-fetched rows — no second
  // query. Keyed on inferred_target_domain, which is exactly the key `byBrand`
  // and clone_watch_monthly_brand_stats.brand use (it flows from the
  // watchlist's legitimate_domains[0] through the ingest); keying on a
  // normalised brand name would join to nothing (see migration v295).
  const intelByBrand = computeTargetingIntelByBrand(rows);
  const emptyMix: Mix = { top: [], other: 0, unknown: 0, total: 0 };

  const brandRows: BrandTrendRow[] = [...byBrand.entries()]
    .map(([brand, m]) => {
      const intel = intelByBrand.get(brand);
      return {
        brand,
        is_au: isAuBrand(brand),
        clones: m.detected,
        reported_to_netcraft: m.netcraftReported,
        likely_phishing: m.byClassification["likely_phishing"] ?? 0,
        parked: m.byClassification["parked_for_sale"] ?? 0,
        taken_down: m.takenDown,
        declined: m.declined,
        escalated: m.escalated,
        weaponised: m.weaponised,
        deliberate_clones: intel?.tactics.total ?? 0,
        tactic_mix: intel?.tactics ?? emptyMix,
        intent_mix: intel?.intents ?? emptyMix,
        tld_mix: intel?.tlds ?? emptyMix,
        hosting_mix:
          intel?.hosting ?? {
            asns: emptyMix,
            countries: emptyMix,
            frontedN: 0,
            unattributedN: 0,
            originVisibleN: 0,
            total: 0,
          },
        clusters: intel?.clusters.clusters ?? [],
        fingerprinted_clones: intel?.clusters.fingerprintedN ?? 0,
        largest_cluster: intel?.clusters.largestClusterN ?? 0,
      };
    })
    .sort((a, b) => b.clones - a.clones || a.brand.localeCompare(b.brand));

  // Full canonicalised registrar list (not sliced) + drop the Unknown bucket —
  // its count already lives in clone_watch_report_summary.unknown_registrar_count.
  // The weaponisation cut joins on the SAME canonical name, so the two can't
  // split a vendor across spellings; its Unknown bucket is likewise dropped
  // here (rendered on the internal card only).
  const weaponisationByRegistrar = new Map(
    registrarWeaponisation(rows).map((w) => [w.registrar, w]),
  );
  const { rows: rawRegistrars } = buildRegistrarRollup(byBrand);
  const registrarRows: RegistrarTrendRow[] = rollupRegistrars(
    rawRegistrars,
  ).map((r) => ({
    registrar: r.registrar,
    clones: r.clones,
    weaponised: weaponisationByRegistrar.get(r.registrar)?.weaponised ?? 0,
    median_days_to_weaponise:
      weaponisationByRegistrar.get(r.registrar)?.medianDaysToWeaponise ?? null,
  }));

  return { periodMonth, brandRows, registrarRows };
}

