import { describe, expect, it } from "vitest";
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
  const rows = clones("bonds.com.au", 28, "cur");
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
      delta: 12,
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
    const card = buildReportCard(
      inputs({ rows: clones("bonds.com.au", 5), watchlistFallbackSize: 293 }),
    );
    expect(card.watchlistSize).toBe(293);
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
