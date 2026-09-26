import { describe, expect, it } from "vitest";
import { LEXICAL_MATCHER_VERSION } from "@askarthur/shopfront-glue";
import {
  BULK_REGISTRATION_MIN_TLDS,
  countTargetingEvents,
  type CloneAlertRow,
} from "@/lib/clone-watch/clone-cohort";
import { aggregateClonesByDomain } from "@/lib/clone-watch/clone-metrics";
import type { BrandCoverage } from "@/lib/clone-watch/brand-coverage";
import { foldFrozenMonths } from "@/lib/clone-watch/monthly-brand-store";
import { monthWindow, priorWindow } from "@/lib/clone-watch/month-window";
import {
  buildReportCard,
  buildTrendRows,
  type CardInputs,
  type FrozenMonth,
} from "@/lib/clone-watch/report-card";

/**
 * #1084 — a bulk registration (one label on ≥4 TLDs in the month) is ONE
 * targeting event for the ranking, the spotlight and the per-brand trend, and
 * every one of its domains is still an alert and still counted per domain.
 *
 * Go-red record (each verified 2026-09-27 by the named edit, then reverted):
 *   B1 fold          — BULK_REGISTRATION_MIN_TLDS 4 → 99 → gonds × 9 reads 9.
 *   B2 threshold     — `>=` → `>` in countTargetingEvents → the 4-TLD group
 *                      is not folded, red.
 *   B3 domains kept  — assign `folded.events` to `m.detected` in
 *                      aggregateClonesByDomain → detected 1, red.
 *   B4 spotlight     — rank by `m.detected` again in buildReportCard → Bonds
 *                      is the spotlight, red.
 *   B5 NULL ≠ 0      — foldFrozenMonths: `?? 0` instead of marking the month
 *                      missing → eventsByBrand is a map, red; and dropping
 *                      `|| !priorEventsMeasured` from classifyTrend's input →
 *                      bonds reads claimable against a v4 month, red.
 *   B6 trend row     — drop `targeting_events` from buildTrendRows → undefined.
 */

const AUG = "2026-08";

function row(brand: string, domain: string, over: Partial<CloneAlertRow> = {}): CloneAlertRow {
  return {
    id: Math.floor(Math.random() * 1e9),
    candidate_domain: domain,
    inferred_target_domain: brand,
    urlscan_classification: null,
    urlscan_evidence: null,
    attribution: null,
    campaign_key: null,
    submitted_to: null,
    lifecycle_state: "declined",
    netcraft_declined_at: null,
    weaponised_at: null,
    first_seen_at: "2026-08-24T00:00:00Z",
    triage_status: null,
    ...over,
  } as CloneAlertRow;
}

const GONDS_TLDS = ["ad", "boo", "cloud", "club", "co", "design", "me", "online", "quest"];
const gonds = () => GONDS_TLDS.map((t) => row("bonds.com.au", `gonds.${t}`));
const distinct = (brand: string, n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => row(brand, `${tag}${i}-${brand.split(".")[0]}.shop`));

const covered = (brandDomain: string): BrandCoverage => ({
  brandDomain,
  brandNormalized: brandDomain.split(".")[0],
  coveredFrom: "2026-05-01",
  coveredTo: null,
});

const frozen = (
  byBrand: Record<string, number>,
  events: Record<string, number> | null,
  matcherVersion = LEXICAL_MATCHER_VERSION,
): FrozenMonth => {
  const m = new Map(Object.entries(byBrand));
  return {
    byBrand: m,
    total: [...m.values()].reduce((a, b) => a + b, 0),
    brands: [...m.values()].filter((n) => n > 0).length,
    matcherVersion,
    sweptDomains: 2_100_000,
    eventsByBrand: events ? new Map(Object.entries(events)) : null,
  };
};

function inputs(over: Partial<CardInputs> = {}): CardInputs {
  const window = monthWindow(AUG);
  return {
    window,
    priorWindow: priorWindow(window.startIso),
    rows: [],
    priorRows: [],
    coverage: [covered("bonds.com.au"), covered("kmart.com.au")],
    priorSpotlightBrand: null,
    watchlistFallbackSize: 293,
    ...over,
  };
}

describe("B1/B2 — countTargetingEvents", () => {
  it("folds gonds × 9 TLDs into one event", () => {
    const r = countTargetingEvents(GONDS_TLDS.map((t) => `gonds.${t}`));
    expect(r.events).toBe(1);
    expect(r.bulkRegistrations).toEqual([{ label: "gonds", domains: 9 }]);
  });

  it(`folds at exactly ${BULK_REGISTRATION_MIN_TLDS} TLDs and not at ${BULK_REGISTRATION_MIN_TLDS - 1}`, () => {
    expect(countTargetingEvents(["a.co", "a.me", "a.shop", "a.xyz"]).events).toBe(1);
    expect(countTargetingEvents(["a.co", "a.me", "a.shop"]).events).toBe(3);
  });

  it("different labels are separate events; a repeated domain is one", () => {
    expect(countTargetingEvents(["b0nds.shop", "bonos.buzz", "bnds.cl", "bnds.cl"]).events).toBe(3);
  });

  it("the key is the matcher's: an IDN / confusable spelling of the same name folds with it", () => {
    // Cyrillic а in the first two; ASCII in the rest.
    expect(countTargetingEvents(["аpple.co", "аpple.me", "apple.shop", "apple.xyz"]).events).toBe(1);
  });
});

describe("B3 — every domain is still an alert and still counted per domain", () => {
  it("detected / declined stay per domain; only targetingEvents folds", () => {
    const m = aggregateClonesByDomain([...gonds(), ...distinct("bonds.com.au", 3, "d")]).get("bonds.com.au")!;
    expect(m.detected).toBe(12);
    expect(m.declined).toBe(12);
    expect(m.targetingEvents).toBe(4);
    expect(m.bulkRegistrations).toEqual([{ label: "gonds", domains: 9 }]);
  });

  it("is per brand: the same label on two brands folds within each, never across", () => {
    const rows = [
      ...GONDS_TLDS.slice(0, 2).map((t) => row("bonds.com.au", `gonds.${t}`)),
      ...GONDS_TLDS.slice(2, 4).map((t) => row("other.com.au", `gonds.${t}`)),
    ];
    const by = aggregateClonesByDomain(rows);
    expect(by.get("bonds.com.au")!.targetingEvents).toBe(2);
    expect(by.get("other.com.au")!.targetingEvents).toBe(2);
  });
});

describe("B4 — the spotlight and the ranking count a bulk registration once", () => {
  // July (v5, published): both brands 20. August: Bonds 40 distinct + gonds × 9
  // = 49 domains / 41 events; Kmart 45 distinct. By domains Bonds is the
  // sharpest riser (+29 vs +25) — which is exactly the August 2026 story. By
  // targeting events it is Kmart (+25 vs +21).
  const card = () =>
    buildReportCard(
      inputs({
        rows: [...gonds(), ...distinct("bonds.com.au", 40, "b"), ...distinct("kmart.com.au", 45, "k")],
        priorStore: new Map([
          ["2026-07-01", frozen({ "bonds.com.au": 20, "kmart.com.au": 20 }, { "bonds.com.au": 20, "kmart.com.au": 20 })],
        ]),
        sweptDomains: 2_100_000,
      }),
    );

  it("leads with Kmart, not the brand a bulk drop inflated", () => {
    const c = card();
    expect(c.spotlight).toMatchObject({ kind: "mover", brand: "kmart.com.au", delta: 25 });
    expect(c.topAuBrands[0]).toEqual({ brand: "kmart.com.au", clones: 45 });
    expect(c.topAuBrands[1]).toEqual({ brand: "bonds.com.au", clones: 41 });
  });

  it("the headline total stays in domains — every registration is real", () => {
    expect(card().total).toBe(94);
  });
});

describe("B5 — NULL is not 0: a month frozen without events is not compared", () => {
  it("foldFrozenMonths: one row without targeting_events makes the month's events unknown", () => {
    const m = foldFrozenMonths([
      { period_month: "2026-09-01", brand: "bonds.com.au", clones: 9, targeting_events: 1, matcher_version: "v5", swept_domains: null },
      { period_month: "2026-09-01", brand: "kmart.com.au", clones: 3, targeting_events: null, matcher_version: "v5", swept_domains: null },
      { period_month: "2026-10-01", brand: "bonds.com.au", clones: 9, targeting_events: 1, matcher_version: "v5", swept_domains: null },
    ]);
    expect(m.get("2026-09-01")!.eventsByBrand).toBeNull();
    expect(m.get("2026-10-01")!.eventsByBrand).toEqual(new Map([["bonds.com.au", 1]]));
  });

  it("a prior month with no event counts withholds the brand delta, even on the same matcher", () => {
    const c = buildReportCard(
      inputs({
        rows: distinct("bonds.com.au", 60, "b"),
        priorStore: new Map([["2026-07-01", frozen({ "bonds.com.au": 20 }, null)]]),
      }),
    );
    expect(c.brandTrends.claimable).toEqual([]);
    expect(c.brandTrends.excluded.methodChanged).toBe(1);
  });
});

describe("B6 — the store row carries targeting_events beside clones", () => {
  it("clones = domains, targeting_events = events", () => {
    const t = buildTrendRows({ window: monthWindow(AUG), rows: [...gonds(), ...distinct("bonds.com.au", 3, "d")] });
    expect(t.brandRows[0]).toMatchObject({ brand: "bonds.com.au", clones: 12, targeting_events: 4 });
  });
});
