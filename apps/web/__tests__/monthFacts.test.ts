import { describe, expect, it, vi } from "vitest";

import type { CloneAlertRow } from "@/lib/clone-watch/clone-cohort";
import {
  countsFromCohortRows,
  countsFromStoreRow,
  lastClosedAndCurrentMonths,
  monthBasis,
  readBrandMonthFacts,
  type BrandMonthFacts,
} from "@/lib/clone-watch/month-facts";
import { describeMonthFacts } from "@/lib/clone-watch/targeting-copy";

/**
 * Month Facts (#1296): a published month comes ONLY from the frozen store, the
 * open month is a provisional cohort recount, a closed unfrozen month has no
 * number. The I/O tests pin which relation each basis reads — the property
 * that keeps a closed month from being recounted live.
 */

const OCT_10 = new Date("2026-10-10T00:00:00Z");

describe("monthBasis — the open/closed rule", () => {
  it("a frozen month is published, even the current one (operator froze early)", () => {
    expect(monthBasis("2026-09-01", "2026-10-01T11:01:22Z", OCT_10)).toBe("published");
    expect(monthBasis("2026-10-01", "2026-10-05T00:00:00Z", OCT_10)).toBe("published");
  });
  it("the open month is provisional", () => {
    expect(monthBasis("2026-10-01", null, OCT_10)).toBe("provisional");
  });
  it("a closed month that is not frozen is unpublished — never recounted", () => {
    expect(monthBasis("2026-09-01", null, OCT_10)).toBe("unpublished");
    // The hours between month end and the 1st's summary run.
    expect(monthBasis("2026-09-01", null, new Date("2026-10-01T03:00:00Z"))).toBe("unpublished");
  });
});

describe("counts", () => {
  it("store row → counts; targeting_events null stays null (v4 month), never 0", () => {
    expect(
      countsFromStoreRow({
        clones: 12,
        targeting_events: null,
        reported_to_netcraft: 3,
        weaponised: 2,
        taken_down: 1,
      }),
    ).toEqual({ clones: 12, targetingEvents: null, reportedToNetcraft: 3, weaponised: 2, takenDown: 1 });
  });

  const row = (over: Partial<CloneAlertRow>): CloneAlertRow =>
    ({
      id: 1,
      candidate_domain: "x.com",
      inferred_target_domain: "reece.com.au",
      urlscan_classification: null,
      urlscan_evidence: null,
      attribution: null,
      submitted_to: null,
      ...over,
    }) as CloneAlertRow;

  it("cohort rows → the store producer's fold (per-brand dedupe, v5 events)", () => {
    const rows = [
      row({ id: 1, candidate_domain: "reece-a.com", lifecycle_state: "weaponised", submitted_to: { netcraft: {} } }),
      row({ id: 2, candidate_domain: "reece-a.com" }), // duplicate domain: once
      row({ id: 3, candidate_domain: "reece-b.com", lifecycle_state: "taken_down" }),
      row({ id: 4, candidate_domain: "other.com", inferred_target_domain: "nab.com.au" }),
    ];
    expect(countsFromCohortRows(rows, "reece.com.au", "2026-10-01")).toEqual({
      clones: 2,
      targetingEvents: 2,
      reportedToNetcraft: 1,
      weaponised: 1,
      takenDown: 1,
    });
    // Pre-v5 period: not measured in events.
    expect(countsFromCohortRows(rows, "reece.com.au", "2026-09-01").targetingEvents).toBeNull();
  });
});

function fakeSb(opts: { frozenAt: string | null; storeRow?: unknown; cohortRows?: unknown[] }) {
  const from = vi.fn((rel: string) => {
    const b: Record<string, unknown> = {};
    for (const k of ["select", "eq", "not", "gte", "lt", "order"]) b[k] = vi.fn(() => b);
    b.limit = vi.fn(() =>
      rel === "clone_watch_monthly_brand_stats"
        ? Promise.resolve({
            data: opts.frozenAt ? [{ frozen_at: opts.frozenAt }] : [],
            error: null,
          })
        : Promise.resolve({ data: opts.cohortRows ?? [], error: null }),
    );
    b.maybeSingle = vi.fn(() => Promise.resolve({ data: opts.storeRow ?? null, error: null }));
    return b;
  });
  return { sb: { from } as never, from };
}

describe("readBrandMonthFacts — which relation each basis reads", () => {
  it("published: the store row, and the cohort is never read", async () => {
    const { sb, from } = fakeSb({
      frozenAt: "2026-10-01T11:01:22Z",
      storeRow: { clones: 12, targeting_events: null, reported_to_netcraft: 3, weaponised: 2, taken_down: 1 },
    });
    const f = await readBrandMonthFacts(sb, "Reece.com.au", "2026-09", OCT_10);
    expect(f.basis).toBe("published");
    expect(f.counts?.weaponised).toBe(2);
    expect(from).not.toHaveBeenCalledWith("clone_watch_brand_cohort");
  });

  it("published without a row for the brand: counts null (not watched), never 0", async () => {
    const { sb } = fakeSb({ frozenAt: "2026-10-01T11:01:22Z", storeRow: null });
    const f = await readBrandMonthFacts(sb, "reece.com.au", "2026-09", OCT_10);
    expect(f.counts).toBeNull();
  });

  it("unpublished: no number, and the cohort is never read", async () => {
    const { sb, from } = fakeSb({ frozenAt: null });
    const f = await readBrandMonthFacts(sb, "reece.com.au", "2026-09", OCT_10);
    expect(f).toMatchObject({ basis: "unpublished", counts: null });
    expect(from).not.toHaveBeenCalledWith("clone_watch_brand_cohort");
  });

  it("provisional: a recount over the Brand Cohort view", async () => {
    const { sb, from } = fakeSb({
      frozenAt: null,
      cohortRows: [
        { id: 1, candidate_domain: "reece-a.com", inferred_target_domain: "reece.com.au", submitted_to: null },
      ],
    });
    const f = await readBrandMonthFacts(sb, "reece.com.au", "2026-10", OCT_10);
    expect(f.basis).toBe("provisional");
    expect(f.counts?.clones).toBe(1);
    expect(from).toHaveBeenCalledWith("clone_watch_brand_cohort");
    expect(from).not.toHaveBeenCalledWith("shopfront_clone_alerts");
  });
});

describe("wording and months", () => {
  const base: BrandMonthFacts = {
    brand: "reece.com.au",
    periodMonth: "2026-09-01",
    label: "September 2026",
    basis: "published",
    frozenAt: "2026-10-01T11:01:22Z",
    counts: { clones: 12, targetingEvents: null, reportedToNetcraft: 3, weaponised: 2, takenDown: 1 },
  };
  it("the basis always travels with the number", () => {
    expect(describeMonthFacts(base)).toBe(
      "September 2026 (published): 12 lookalike domains · 2 weaponised · 1 taken down",
    );
    expect(
      describeMonthFacts({ ...base, basis: "provisional", label: "October 2026", counts: { ...base.counts!, weaponised: 0, takenDown: 0, clones: 1 } }),
    ).toBe("October 2026 so far (provisional): 1 lookalike domain");
    expect(describeMonthFacts({ ...base, basis: "unpublished", counts: null })).toBe(
      "September 2026: not published yet",
    );
    expect(describeMonthFacts({ ...base, counts: null })).toBe(
      "September 2026 (published): not watched that month",
    );
  });
  it("last closed and current month, across a year boundary", () => {
    expect(lastClosedAndCurrentMonths(new Date("2027-01-03T00:00:00Z"))).toEqual({
      lastClosed: "2026-12-01",
      current: "2027-01-01",
    });
  });
});
