import { describe, expect, it } from "vitest";
import {
  planCoverageSync,
  type WatchlistSnapshotEntry,
} from "@/lib/clone-watch/record-coverage";

/**
 * `planCoverageSync` decides when a brand enters and leaves coverage, and the
 * trend gate refuses to publish anything about a brand whose coverage it cannot
 * vouch for. So this Module gates every published month-over-month claim — and
 * it was the only new Module in the feature with no tests, while
 * `classifyTrend`, which merely consumes its output, had nineteen.
 *
 * It needs no port to be tested: it is set arithmetic over two lists. The
 * `CoverageStore` Interface it used to sit behind was larger than the
 * Implementation and had exactly one Adapter, written inline in the cron —
 * a hypothetical Seam. The cron now owns its own reads and writes, matching
 * ADR-0020's pure-Module-plus-app-side-Adapter shape.
 */

const entry = (brand: string, domain: string): WatchlistSnapshotEntry => ({
  brand,
  legitimate_domains: [domain],
});

const ASOF = "2026-09-03";

describe("planCoverageSync", () => {
  it("opens coverage for a brand that JOINS the watchlist", () => {
    // Without this the brand reads coverage_unknown and, because the gate fails
    // closed, its trends are suppressed forever with no error.
    const plan = planCoverageSync([entry("Bunnings", "bunnings.com.au")], [], ASOF);
    expect(plan.toAdd).toEqual([
      {
        brand: "Bunnings",
        brand_normalized: "bunnings",
        brand_domain: "bunnings.com.au",
        covered_from: ASOF,
        source: "live",
      },
    ]);
    expect(plan.toClose).toEqual([]);
  });

  it("closes coverage for a brand that LEAVES the watchlist", () => {
    // The inverse failure, and the more dangerous one: a de-listed brand that
    // stays "covered" publishes its silence as "targeting collapsed".
    const plan = planCoverageSync(
      [entry("Bunnings", "bunnings.com.au")],
      [
        { brand_normalized: "bunnings", covered_to: null },
        { brand_normalized: "lendi", covered_to: null },
      ],
      ASOF,
    );
    expect(plan.toClose).toEqual(["lendi"]);
    expect(plan.toAdd).toEqual([]);
  });

  it("plans nothing when the watchlist is unchanged", () => {
    const plan = planCoverageSync(
      [entry("Bunnings", "bunnings.com.au")],
      [{ brand_normalized: "bunnings", covered_to: null }],
      ASOF,
    );
    expect(plan).toEqual({ toAdd: [], toClose: [], unchanged: 1 });
  });

  it("re-opens a brand whose previous window was CLOSED", () => {
    // A brand removed and later re-added needs a fresh window; treating the
    // closed row as coverage would claim months we were not watching.
    const plan = planCoverageSync(
      [entry("Lendi", "lendi.com.au")],
      [{ brand_normalized: "lendi", covered_to: "2026-06-07" }],
      ASOF,
    );
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0]).toMatchObject({ brand_normalized: "lendi", covered_from: ASOF });
    // It is not "open", so it must not also be queued for closing.
    expect(plan.toClose).toEqual([]);
  });

  it("skips an entry with no primary domain rather than planning an unjoinable row", () => {
    // brand_domain is the join key to the monthly stats; a row without one can
    // never match anything, and NOT NULL (v297) would reject it anyway.
    const plan = planCoverageSync([{ brand: "Ghost", legitimate_domains: [] }], [], ASOF);
    expect(plan.toAdd).toEqual([]);
  });

  it("keeps the FIRST entry when two brands normalise to the same key", () => {
    const plan = planCoverageSync(
      [entry("The Ordinary", "theordinary.com"), entry("the ordinary", "deciem.com")],
      [],
      ASOF,
    );
    expect(plan.toAdd).toHaveLength(1);
    expect(plan.toAdd[0]).toMatchObject({ brand_domain: "theordinary.com" });
  });

  it("keeps BOTH brands that share a primary domain", () => {
    // Services Australia, Medicare and Centrelink all list
    // servicesaustralia.gov.au. Keying on the domain dropped two of them
    // entirely and they read as coverage_unknown forever.
    const plan = planCoverageSync(
      [
        entry("Services Australia", "servicesaustralia.gov.au"),
        entry("Medicare", "servicesaustralia.gov.au"),
        entry("Centrelink", "servicesaustralia.gov.au"),
      ],
      [],
      ASOF,
    );
    expect(plan.toAdd.map((r) => r.brand_normalized).sort()).toEqual([
      "centrelink",
      "medicare",
      "servicesaustralia",
    ]);
  });

  it("handles a join and a departure in the same run", () => {
    const plan = planCoverageSync(
      [entry("Aesop", "aesop.com")],
      [{ brand_normalized: "lendi", covered_to: null }],
      ASOF,
    );
    expect(plan.toAdd[0]).toMatchObject({ brand_normalized: "aesop" });
    expect(plan.toClose).toEqual(["lendi"]);
    expect(plan.unchanged).toBe(0);
  });
});
