import { describe, expect, it } from "vitest";
import { LEXICAL_MATCHER_VERSION } from "@askarthur/shopfront-glue";
import type { FrozenMonth } from "@/lib/clone-watch/report-card";
import { foldFrozenMonths } from "@/lib/clone-watch/monthly-brand-store";
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import type { BrandCoverage } from "@/lib/clone-watch/brand-coverage";
import { monthWindow, priorWindow } from "@/lib/clone-watch/month-window";
import {
  buildReportCard,
  buildTrendRows,
  type CardInputs,
} from "@/lib/clone-watch/report-card";

/**
 * The card had NO test until now, because `getCloneWatchReportCard` opened with
 * `createServiceClient()` and nothing downstream could be computed from
 * fixtures. Meanwhile the caption's CONSUMERS of its output were pinned nine
 * ways from hand-built cards — so the shape was well covered and the thing that
 * produces it had never executed under test.
 *
 * These are the rules with the most editorial consequence: which brands appear
 * at all, whether a month-on-month delta is shown, and what the methodology
 * line's denominator is.
 */

const AUG = "2026-08";

function row(
  brand: string,
  domain: string,
  over: Partial<CloneAlertRow> = {},
): CloneAlertRow {
  return {
    id: Math.floor(Math.random() * 1e9),
    candidate_domain: domain,
    inferred_target_domain: brand,
    urlscan_classification: null,
    urlscan_evidence: null,
    attribution: null,
    campaign_key: null,
    submitted_to: null,
    lifecycle_state: null,
    netcraft_declined_at: null,
    weaponised_at: null,
    first_seen_at: "2026-08-10T00:00:00Z",
    triage_status: null,
    ...over,
  } as CloneAlertRow;
}

/** N distinct clone domains impersonating one brand. */
const clones = (brand: string, n: number, tag = "x"): CloneAlertRow[] =>
  Array.from({ length: n }, (_, i) => row(brand, `${tag}${i}-${brand}`));

const coveredThroughout = (brandDomain: string): BrandCoverage => ({
  brandDomain,
  brandNormalized: brandDomain.split(".")[0],
  coveredFrom: "2026-05-01",
  coveredTo: null,
});

function inputs(over: Partial<CardInputs> = {}): CardInputs {
  const window = monthWindow(AUG);
  return {
    window,
    priorWindow: priorWindow(window.startIso),
    rows: [],
    priorRows: [],
    coverage: [],
    priorSpotlightBrand: null,
    watchlistFallbackSize: 293,
    ...over,
  };
}

describe("buildReportCard — the brand rankings", () => {
  it("splits AU from global by TLD, and excludes gov from BOTH", () => {
    // Gov domains are neither consumer "brands" nor global — but they still
    // count toward the headline total.
    const card = buildReportCard(
      inputs({
        rows: [
          ...clones("bonds.com.au", 5, "a"),
          ...clones("apple.com", 4, "b"),
          ...clones("servicesaustralia.gov.au", 3, "c"),
        ],
      }),
    );
    expect(card.topAuBrands.map((b) => b.brand)).toEqual(["bonds.com.au"]);
    expect(card.globalBrands.map((b) => b.brand)).toEqual(["apple.com"]);
    expect(card.total).toBe(12);
    expect(card.brands).toBe(3);
  });

  it("ranks by clone count descending, ties broken by name", () => {
    const card = buildReportCard(
      inputs({
        rows: [
          ...clones("bbb.com.au", 3, "a"),
          ...clones("aaa.com.au", 3, "b"),
          ...clones("ccc.com.au", 9, "c"),
        ],
      }),
    );
    expect(card.topAuBrands.map((b) => b.brand)).toEqual([
      "ccc.com.au",
      "aaa.com.au",
      "bbb.com.au",
    ]);
  });
});

describe("buildReportCard — the month-on-month gate", () => {
  it("withholds a delta when the prior month has no clones", () => {
    const card = buildReportCard(inputs({ rows: clones("bonds.com.au", 20) }));
    expect(card.mom.available).toBe(false);
  });

  it("shows a delta when both months are fully tracked", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 28, "cur"),
        priorRows: clones("bonds.com.au", 16, "pri"),
      }),
    );
    expect(card.mom.available).toBe(true);
    expect(card.mom.priorTotal).toBe(16);
    expect(card.mom.totalDelta).toBe(12);
    expect(card.mom.totalPct).toBe(75);
  });

  it("refuses a percentage off a zero base rather than dividing by it", () => {
    const card = buildReportCard(inputs({ rows: clones("bonds.com.au", 5) }));
    expect(card.mom.totalPct).toBeNull();
  });
});

describe("buildReportCard — the coverage gate feeds the ladder", () => {
  // 16 -> 40 (+3.2σ): beyond counting noise, so a mover (#1226).
  const rows = clones("bonds.com.au", 40, "cur");
  const priorRows = clones("bonds.com.au", 16, "pri");

  it("publishes a mover when the brand was monitored across both months", () => {
    const card = buildReportCard(
      inputs({
        rows,
        priorRows,
        coverage: [coveredThroughout("bonds.com.au")],
      }),
    );
    expect(card.spotlight).toMatchObject({
      kind: "mover",
      brand: "bonds.com.au",
      priorClones: 16,
      delta: 24,
    });
  });

  it("WITHHOLDS the same movement when coverage began mid-window", () => {
    // The Ordinary's 1 -> 11 is the canonical case: it clears every volume
    // threshold and is entirely an artefact of the 2026-07-21 watchlist commit.
    const card = buildReportCard(
      inputs({
        rows,
        priorRows,
        coverage: [
          { ...coveredThroughout("bonds.com.au"), coveredFrom: "2026-07-21" },
        ],
      }),
    );
    expect(card.spotlight.kind).toBe("globals");
    expect(card.brandTrends.excluded.coverageStarted).toBe(1);
  });

  it("fails CLOSED when the coverage read errored", () => {
    // null (read failed) must not be mistaken for [] (table empty): both
    // suppress every claim, but only one of them is a bug.
    const card = buildReportCard({
      ...inputs({ rows, priorRows }),
      coverage: null,
    });
    expect(card.brandTrends.publishable).toBe(false);
    expect(card.spotlight.kind).toBe("globals");
  });

  it("is also unpublishable when the coverage table is simply empty", () => {
    const card = buildReportCard(inputs({ rows, priorRows, coverage: [] }));
    expect(card.brandTrends.publishable).toBe(false);
  });
});

describe("buildReportCard — watchlistSize", () => {
  it("counts brands monitored for the WHOLE reported month", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 5),
        coverage: [
          coveredThroughout("bonds.com.au"),
          coveredThroughout("kmart.com.au"),
          // Started mid-August — not monitored for the whole month.
          { ...coveredThroughout("mecca.com.au"), coveredFrom: "2026-08-14" },
        ],
      }),
    );
    expect(card.watchlistSize).toBe(2);
  });

  it("falls back to the supplied watchlist size when coverage yields nothing", () => {
    // An explicit input, NOT a module-level read of AU_BRAND_WATCHLIST.length —
    // an ambient value makes the fold non-deterministic across processes, which
    // defeats the point of computing an edition once.
    //
    // 7 is deliberately a number the real watchlist can never be. The original
    // assertion used 293, which was ALSO AU_BRAND_WATCHLIST.length at the time —
    // so it passed against a fold that ignored the input entirely, and would
    // have gone red the day someone added a brand. A fallback test whose
    // expected value can be produced by the thing it is meant to exclude proves
    // nothing.
    const card = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 5), watchlistFallbackSize: 7 }),
    );
    expect(card.watchlistSize).toBe(7);
  });
});

describe("buildTrendRows folds the SAME rows the card does", () => {
  it("reconciles: per-brand clones sum back to the card total", () => {
    const rows = [
      ...clones("bonds.com.au", 7, "a"),
      ...clones("apple.com", 4, "b"),
    ];
    const i = inputs({ rows });
    const card = buildReportCard(i);
    const trend = buildTrendRows(i);
    const summed = trend.brandRows.reduce((n, r) => n + r.clones, 0);
    expect(summed).toBe(card.total);
    expect(trend.brandRows).toHaveLength(card.brands);
  });

  it("marks AU brands with the same rule the card ranks by", () => {
    const trend = buildTrendRows(
      inputs({
        rows: [
          ...clones("bonds.com.au", 2, "a"),
          ...clones("apple.com", 2, "b"),
          ...clones("servicesaustralia.gov.au", 2, "c"),
        ],
      }),
    );
    const byBrand = Object.fromEntries(
      trend.brandRows.map((r) => [r.brand, r.is_au]),
    );
    expect(byBrand["bonds.com.au"]).toBe(true);
    expect(byBrand["apple.com"]).toBe(false);
    // Gov is not a "brand" for ranking purposes, on either surface.
    expect(byBrand["servicesaustralia.gov.au"]).toBe(false);
  });
});

// ── #1226 — honest month-over-month ─────────────────────────────────────────

const frozen = (byBrand: Record<string, number>, over: Partial<FrozenMonth> = {}): FrozenMonth => {
  const m = new Map(Object.entries(byBrand));
  return {
    byBrand: m,
    total: [...m.values()].reduce((a, b) => a + b, 0),
    brands: [...m.values()].filter((n) => n > 0).length,
    matcherVersion: LEXICAL_MATCHER_VERSION,
    sweptDomains: 2_100_000,
    ...over,
  };
};

describe("buildReportCard — month-over-month reads the FROZEN prior month (#1226)", () => {
  /*
   * Go-red record:
   *   - "compares against what July PUBLISHED": use priorByBrand even when a
   *     frozen month exists → prior 16 (the live recount) instead of 30.
   *   - "withholds every delta across a matcher change": drop `methodChanged`
   *     from classifyTrend's input → bonds reads claimable.
   *   - "flags a feed-volume shift": drop the FEED_SHIFT_THRESHOLD check →
   *     feedShift is non-null at +5%.
   */
  const cov = [coveredThroughout("bonds.com.au")];

  it("compares against what July PUBLISHED, not today's recount of July", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 60, "cur"),
        priorRows: clones("bonds.com.au", 16, "pri"), // re-triaged since
        coverage: cov,
        priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 30 })]]),
        sweptDomains: 2_100_000,
      }),
    );
    expect(card.mom).toMatchObject({ priorSource: "store", priorTotal: 30, totalDelta: 30 });
    expect(card.brandTrends.claimable[0]).toMatchObject({ brand: "bonds.com.au", priorClones: 30, delta: 30 });
  });

  it("falls back to the live recount, and says so, when no frozen month exists", () => {
    const card = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 60, "cur"), priorRows: clones("bonds.com.au", 16, "pri"), coverage: cov }),
    );
    expect(card.mom.priorSource).toBe("live");
    expect(card.mom.priorTotal).toBe(16);
  });

  it("withholds every delta across a matcher change", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 60, "cur"),
        coverage: cov,
        priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 20 }, { matcherVersion: "v3" })]]),
      }),
    );
    expect(card.mom.methodChanged).toBe(true);
    expect(card.mom.available).toBe(false);
    expect(card.brandTrends.claimable).toEqual([]);
    expect(card.brandTrends.excluded.methodChanged).toBe(1);
  });

  it("flags a feed-volume shift over 20%, and not one under", () => {
    const at = (swept: number) =>
      buildReportCard(
        inputs({
          rows: clones("bonds.com.au", 60, "cur"),
          coverage: cov,
          priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 30 })]]),
          sweptDomains: swept,
        }),
      ).mom.feedShift;
    expect(at(2_205_000)).toBeNull(); // +5%
    expect(at(1_400_000)).toEqual({ priorSwept: 2_100_000, currentSwept: 1_400_000, pct: -33 });
  });

  it("carries a three-month series; an unpublished month is null, never 0", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 60, "cur"),
        coverage: cov,
        priorStore: new Map([
          ["2026-07-01", frozen({ "bonds.com.au": 30 })],
          ["2026-06-01", frozen({ "bonds.com.au": 12 })],
        ]),
      }),
    );
    expect(card.brandTrends.claimable[0]!.series).toEqual([12, 30, 60]);
    expect(card.mom.series!.map((p) => p.total)).toEqual([12, 30, 60]);
    const noJune = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 60, "cur"), coverage: cov, priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 30 })]]) }),
    );
    expect(noJune.mom.series![0]!.total).toBeNull();
  });

  it("marks the total 'noise' within 2σ and gives no percentage below the floor", () => {
    const card = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 33, "cur"), coverage: cov, priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 30 })]]) }),
    );
    expect(card.mom.noise).toBe(true);
    const small = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 8, "cur"), coverage: cov, priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 3 })]]) }),
    );
    expect(small.mom.totalPct).toBeNull();
  });
});

describe("month-over-month — review fixes (#1247)", () => {
  const cov = [coveredThroughout("bonds.com.au")];

  it("judges the matcher by the reported month's STAMPED version when it is frozen", () => {
    // August re-computed after a hypothetical v5 bump: both months were v4.
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 60, "cur"),
        coverage: cov,
        priorStore: new Map([
          ["2026-08-01", frozen({ "bonds.com.au": 60 }, { matcherVersion: "v3" })],
          ["2026-07-01", frozen({ "bonds.com.au": 30 }, { matcherVersion: "v3" })],
        ]),
      }),
    );
    expect(card.mom.methodChanged).toBe(false);
  });

  it("drops a series point from a different matcher, and never shows a live recount as published", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 60, "cur"),
        coverage: cov,
        priorStore: new Map([
          ["2026-07-01", frozen({ "bonds.com.au": 30 })],
          ["2026-06-01", frozen({ "bonds.com.au": 12 }, { matcherVersion: "v3" })],
        ]),
      }),
    );
    expect(card.mom.series!.map((p) => p.total)).toEqual([null, 30, 60]);
    const live = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 60, "cur"), priorRows: clones("bonds.com.au", 16, "pri"), coverage: cov }),
    );
    expect(live.mom.series![1]!.total).toBeNull();
    expect(live.brandTrends.claimable[0]!.series![1]).toBeNull();
  });

  it("a brand absent from a published month is null in its series, not 0", () => {
    const card = buildReportCard(
      inputs({
        rows: clones("bonds.com.au", 60, "cur"),
        coverage: cov,
        priorStore: new Map([
          ["2026-07-01", frozen({ "bonds.com.au": 30 })],
          ["2026-06-01", frozen({ "other.com.au": 12 })],
        ]),
      }),
    );
    expect(card.brandTrends.claimable[0]!.series).toEqual([null, 30, 60]);
  });
});

describe("foldFrozenMonths", () => {
  it("sums per month, lower-cases brands, counts only targeted brands, keeps provenance", () => {
    const got = foldFrozenMonths([
      { period_month: "2026-07-01", brand: "Bonds.com.au", clones: 5, matcher_version: "v4", swept_domains: "2100000" },
      { period_month: "2026-07-01", brand: "westpac.com.au", clones: 0, matcher_version: "v4", swept_domains: "2100000" },
      { period_month: "2026-06-01", brand: "bonds.com.au", clones: 2, matcher_version: "v4", swept_domains: null },
    ]);
    expect(got.get("2026-07-01")).toMatchObject({ total: 5, brands: 1, matcherVersion: "v4", sweptDomains: 2_100_000 });
    expect(got.get("2026-07-01")!.byBrand.get("bonds.com.au")).toBe(5);
    expect(got.get("2026-06-01")!.sweptDomains).toBeNull();
  });
});
