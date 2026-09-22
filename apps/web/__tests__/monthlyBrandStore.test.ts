import { describe, expect, it } from "vitest";
import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import { aggregateClonesByDomain } from "@/lib/clone-watch/clone-metrics";
import { monthWindow, priorWindow } from "@/lib/clone-watch/month-window";
import { buildTrendRows, type CardInputs } from "@/lib/clone-watch/report-card";
import {
  brandKeyForDomain,
  ledgerCloneMetrics,
  shouldEmitStoreWritten,
  takedownEventsFromRows,
  type LedgerStoreRow,
} from "@/lib/clone-watch/monthly-brand-store";

/**
 * PR 7 — one monthly per-brand store. The TS half: the producer's new columns
 * and the stewardship ledger's read of the store.
 *
 * Go-red record (each verified by reinstating the named bug):
 *   - event-dated takedowns: drop the window check in takedownsInMonthByBrand
 *     → July credits August's takedown, August counts September's.
 *   - weaponised_ever: count `lifecycle_state === "weaponised"` → 1 (the clone
 *     taken down after weaponising disappears).
 *   - ledger reads the store: take `detected` from the refold instead of the
 *     store row → 3 instead of 7.
 *   - emit policy: always emit → a manual no-op re-run re-prepares.
 *   - brand key: drop the single-coverage-mapping rule → "cba".
 */

const AUG = "2026-08";

function row(
  brand: string,
  domain: string,
  over: Partial<CloneAlertRow> = {},
): CloneAlertRow {
  return {
    id: 1,
    candidate_domain: domain,
    inferred_target_domain: brand,
    target_brand_normalized: null,
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

describe("buildTrendRows — event-dated takedowns", () => {
  const events = takedownEventsFromRows([
    // first seen in JULY, taken down in AUGUST → August's number
    row("hellostake.com", "stake-x.com", {
      first_seen_at: "2026-07-10T00:00:00Z",
      submitted_to: { netcraft: { takedown_at: "2026-08-02 10:00:00+00" } },
    }),
    // first seen in August, taken down in September → not August's
    row("hellostake.com", "stake-late.com", {
      submitted_to: { netcraft: { takedown_at: "2026-09-01T00:00:00Z" } },
    }),
    // two rows for one candidate → counted once
    row("hellostake.com", "stake-dup.com", {
      submitted_to: { netcraft: { takedown_at: "2026-08-20T00:00:00Z" } },
    }),
    row("hellostake.com", "stake-dup.com", {
      submitted_to: { netcraft: { takedown_at: "2026-08-21T00:00:00Z" } },
    }),
    // fp-triaged → never counted
    row("hellostake.com", "stake-fp.com", {
      triage_status: "fp",
      submitted_to: { netcraft: { takedown_at: "2026-08-03T00:00:00Z" } },
    }),
    // no takedown stamp → not an event
    row("hellostake.com", "stake-undated.com", { lifecycle_state: "taken_down" }),
  ]);

  it("credits a takedown to the month it HAPPENED, not the month the clone was first seen", () => {
    const aug = buildTrendRows(
      inputs({
        rows: [row("hellostake.com", "stake-aug.com")],
        takedownEvents: events,
      }),
    );
    expect(aug.brandRows[0].taken_down_in_month).toBe(2);

    const jul = buildTrendRows(
      inputs({
        window: monthWindow("2026-07"),
        rows: [row("hellostake.com", "stake-x.com", { first_seen_at: "2026-07-10T00:00:00Z" })],
        takedownEvents: events,
      }),
    );
    expect(jul.brandRows[0].taken_down_in_month).toBe(0);
  });

  it("is null — not zero — when the takedown events were never read", () => {
    const t = buildTrendRows(inputs({ rows: [row("hellostake.com", "a.com")] }));
    expect(t.brandRows[0].taken_down_in_month).toBeNull();
  });
});

describe("buildTrendRows — the store carries every count the ledger prints", () => {
  const rows = [
    // weaponised, then taken down: gone from `weaponised`, still weaponised_ever
    row("hellostake.com", "a.com", {
      id: 10,
      lifecycle_state: "taken_down",
      weaponised_at: "2026-08-11T00:00:00Z",
      submitted_to: { netcraft_issue: { issue_reported_at: "2026-08-12" } },
    }),
    row("hellostake.com", "b.com", {
      id: 11,
      lifecycle_state: "weaponised",
      weaponised_at: "2026-08-12T00:00:00Z",
      netcraft_declined_at: "2026-08-11T00:00:00Z",
    }),
    // duplicate candidate: its id is not membership
    row("hellostake.com", "b.com", { id: 12, weaponised_at: "2026-08-13T00:00:00Z" }),
  ];
  const t = buildTrendRows(inputs({ rows, takedownEvents: [] }));
  const r = t.brandRows[0];

  it("weaponised_ever survives a later takedown; weaponised does not", () => {
    expect(r.weaponised).toBe(1);
    expect(r.weaponised_ever).toBe(2);
  });

  it("stores membership (first id per candidate) and the stewardship counts", () => {
    expect(r.alert_ids).toEqual([10, 11]);
    expect(r.weaponised_after_decline).toBe(1);
    expect(r.re_taken_down).toBe(1);
  });

  it("stores the Canonical Brand key beside the domain", () => {
    const k = buildTrendRows(
      inputs({
        rows: [
          row("servicesaustralia.gov.au", "m1.com", { target_brand_normalized: "medicare" }),
          row("servicesaustralia.gov.au", "m2.com", { target_brand_normalized: "medicare" }),
          row("servicesaustralia.gov.au", "s1.com", { target_brand_normalized: "servicesaustralia" }),
        ],
      }),
    );
    expect(k.brandRows[0].brand).toBe("servicesaustralia.gov.au");
    expect(k.brandRows[0].brand_normalized).toBe("servicesaustralia");
  });
});

describe("brandKeyForDomain", () => {
  const cov = (brandDomain: string, brandNormalized: string) => ({
    brandDomain,
    brandNormalized,
    coveredFrom: "2026-05-01",
    coveredTo: null,
  });
  it("prefers a single coverage mapping — even over the alert majority", () => {
    expect(brandKeyForDomain("hellostake.com", [], [cov("hellostake.com", "stake")])).toBe("stake");
    expect(
      brandKeyForDomain("commbank.com.au", ["cba", "cba"], [cov("commbank.com.au", "commonwealthbank")]),
    ).toBe("commonwealthbank");
  });
  it("picks the domain's owner when several brands share it", () => {
    const c = ["servicesaustralia", "medicare", "centrelink"].map((b) => cov("servicesaustralia.gov.au", b));
    expect(brandKeyForDomain("servicesaustralia.gov.au", ["medicare", "medicare"], c)).toBe("servicesaustralia");
  });
  it("falls back to the most frequent alert key, ties alphabetical", () => {
    expect(brandKeyForDomain("commbank.com.au", ["cba", "cba", "commonwealthbank"], null)).toBe("cba");
    expect(brandKeyForDomain("x.com", ["b", "a"], null)).toBe("a");
  });
  it("falls back to the domain label", () => {
    expect(brandKeyForDomain("7-eleven.com.au", [], null)).toBe("7eleven");
  });
});

describe("ledgerCloneMetrics — stewardship reads the store, not a refold", () => {
  const store: LedgerStoreRow = {
    brand: "hellostake.com",
    clones: 7,
    reported_to_netcraft: 4,
    taken_down: 2,
    taken_down_in_month: 3,
    declined: 1,
    escalated: 1,
    weaponised: 1,
    weaponised_ever: 3,
    weaponised_after_decline: 1,
    re_taken_down: 1,
    alert_ids: [1, 2, 3],
    frozen_at: "2026-09-01T11:05:00Z",
  };
  // The live detail rows disagree with the frozen counts (a lookalike moved
  // state since the month was published): the COUNTS must stay the store's.
  const detail = aggregateClonesByDomain([
    row("hellostake.com", "a.com", { id: 1, lifecycle_state: "declined" }),
    row("hellostake.com", "b.com", { id: 2, lifecycle_state: "declined" }),
    row("hellostake.com", "c.com", { id: 3, lifecycle_state: "monitoring" }),
  ]).get("hellostake.com");

  const m = ledgerCloneMetrics(store, detail);

  it("takes every headline count from the store", () => {
    expect(m.detected).toBe(7);
    expect(m.netcraft_reported).toBe(4);
    expect(m.taken_down).toBe(2);
    expect(m.taken_down_in_month).toBe(3);
    expect(m.weaponised).toBe(1);
    expect(m.weaponised_ever).toBe(3);
    expect(m.weaponised_after_decline).toBe(1);
    expect(m.re_taken_down).toBe(1);
    expect(m.store_frozen_at).toBe("2026-09-01T11:05:00Z");
  });

  it("takes the per-lookalike watch-list from the member alerts", () => {
    expect((m.domains as Array<{ domain: string }>).map((d) => d.domain)).toEqual(["a.com", "b.com", "c.com"]);
    expect(m.alert_ids).toEqual([1, 2, 3]);
  });

  it("still renders counts when no member alert could be read", () => {
    const empty = ledgerCloneMetrics(store, undefined);
    expect(empty.detected).toBe(7);
    expect(empty.domains).toEqual([]);
  });
});

describe("shouldEmitStoreWritten — stewardship runs once per published month", () => {
  it("emits on a fresh write and on a deliberate re-publish", () => {
    expect(shouldEmitStoreWritten("written", { scheduled: true })).toBe(true);
    expect(shouldEmitStoreWritten("republished", { scheduled: false })).toBe(true);
  });
  it("emits on the scheduled run even if the month was already frozen (retry / early manual publish)", () => {
    expect(shouldEmitStoreWritten("frozen", { scheduled: true })).toBe(true);
  });
  it("a manual no-op re-run on a frozen month does NOT re-prepare stewardship", () => {
    expect(shouldEmitStoreWritten("frozen", { scheduled: false })).toBe(false);
  });
  it("emits for a month with no clones so onward/reddit reports still prepare", () => {
    expect(shouldEmitStoreWritten("empty", { scheduled: true })).toBe(true);
    expect(shouldEmitStoreWritten("empty", { scheduled: false })).toBe(false);
  });
});
