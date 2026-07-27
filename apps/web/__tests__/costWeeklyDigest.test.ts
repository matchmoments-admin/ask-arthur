import { describe, expect, it } from "vitest";
import {
  buildCostDigest,
  computeWindowBounds,
  earliestDayNeeded,
  formatCostDigest,
  thisWindowTimestamps,
  WINDOW_DAYS,
  type CostRow,
} from "@/lib/cost-digest";

/**
 * The prod daily totals that produced the 2026-07-26 Telegram digest. Kept as
 * one row per day (feature/provider collapsed) for the window arithmetic, with
 * a separate per-feature fixture below for the ranking assertions.
 *
 * Source: `select day, sum(total_cost_usd), sum(event_count) from
 * daily_cost_summary` on project rquomhcgnodxzkhokwni.
 */
const PROD_DAYS: Array<[string, number, number]> = [
  ["2026-07-12", 0.2712, 445],
  ["2026-07-13", 0.5179, 273],
  ["2026-07-14", 0.3269, 375],
  ["2026-07-15", 0.2788, 341],
  ["2026-07-16", 0.3642, 359],
  ["2026-07-17", 0.2521, 352],
  ["2026-07-18", 0.2494, 331],
  ["2026-07-19", 0.24, 310],
  ["2026-07-20", 0.1779, 368],
  ["2026-07-21", 0.3441, 360],
  ["2026-07-22", 0.1293, 350],
  ["2026-07-23", 0.404, 392],
  ["2026-07-24", 0.3068, 358],
  ["2026-07-25", 0.2725, 347],
  ["2026-07-26", 0.2812, 352],
];

const prodRows: CostRow[] = PROD_DAYS.map(([day, cost, events]) => ({
  day,
  feature: "all",
  provider: "anthropic",
  events,
  cost,
}));

/** The actual send time: Sunday 22:00 UTC per vercel.json `0 22 * * 0`. */
const SEND_TIME = new Date("2026-07-26T22:00:00.000Z");

const sum = (days: string[], pick: (r: CostRow) => number) =>
  prodRows.filter((r) => days.includes(r.day)).reduce((s, r) => s + pick(r), 0);

const range = (from: string, to: string) =>
  PROD_DAYS.map(([d]) => d).filter((d) => d >= from && d <= to);

describe("computeWindowBounds", () => {
  it("uses two equal windows of complete days ending yesterday", () => {
    const b = computeWindowBounds(SEND_TIME);
    expect(b).toEqual({
      thisStart: "2026-07-19",
      thisEnd: "2026-07-25",
      prevStart: "2026-07-12",
      prevEnd: "2026-07-18",
    });
    expect(range(b.thisStart, b.thisEnd)).toHaveLength(WINDOW_DAYS);
    expect(range(b.prevStart, b.prevEnd)).toHaveLength(WINDOW_DAYS);
  });

  it("excludes the partial current day from both windows", () => {
    const b = computeWindowBounds(SEND_TIME);
    expect(b.thisEnd).toBe("2026-07-25");
    expect(b.thisEnd < "2026-07-26").toBe(true);
  });

  it("is independent of the time of day, so cron drift can't shift it", () => {
    const early = computeWindowBounds(new Date("2026-07-26T00:00:01.000Z"));
    const late = computeWindowBounds(new Date("2026-07-26T23:59:59.000Z"));
    expect(early).toEqual(late);
  });

  it("leaves no gap or overlap between the two windows", () => {
    const b = computeWindowBounds(SEND_TIME);
    const dayAfterPrevEnd = new Date(
      Date.parse(`${b.prevEnd}T00:00:00.000Z`) + 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(dayAfterPrevEnd).toBe(b.thisStart);
  });

  it("handles a month boundary", () => {
    expect(computeWindowBounds(new Date("2026-08-03T22:00:00.000Z"))).toEqual({
      thisStart: "2026-07-27",
      thisEnd: "2026-08-02",
      prevStart: "2026-07-20",
      prevEnd: "2026-07-26",
    });
  });

  it("earliestDayNeeded covers the older window's first day", () => {
    expect(earliestDayNeeded(SEND_TIME)).toBe("2026-07-12");
  });
});

describe("buildCostDigest — the 8-vs-7-day regression", () => {
  it("reproduces the buggy 8-day figures so the defect is documented", () => {
    // What the OLD code summed: day >= now-7d, i.e. 07-19…07-26 inclusive.
    const buggyDays = range("2026-07-19", "2026-07-26");
    expect(buggyDays).toHaveLength(8);
    expect(sum(buggyDays, (r) => r.cost)).toBeCloseTo(2.1558, 4);
    expect(sum(buggyDays, (r) => r.events)).toBe(2837); // digest said 2,837
  });

  it("sums 7 complete days instead, excluding the partial send day", () => {
    const d = buildCostDigest(prodRows, SEND_TIME);
    // 07-19…07-25 — the 8-day figure minus 07-26's $0.2812 / 352 events.
    expect(d.thisTotal).toBeCloseTo(1.8746, 4);
    expect(d.thisEvents).toBe(2485);
    expect(d.prevTotal).toBeCloseTo(2.2605, 4);
    expect(d.prevEvents).toBe(2476);
    expect(d.weekEnding).toBe("2026-07-25");
  });

  it("reports the real decline, not the flattered one", () => {
    const d = buildCostDigest(prodRows, SEND_TIME);
    // The shipped digest showed -4.6% by comparing 8 days against 7.
    expect(d.deltaPct).not.toBeNull();
    expect(d.deltaPct!).toBeCloseTo(-17.07, 1);
    expect(d.deltaPct!).toBeLessThan(-10);
  });

  it("compares equal event counts too, so per-event math is sound", () => {
    const d = buildCostDigest(prodRows, SEND_TIME);
    expect(d.windowDays).toBe(WINDOW_DAYS);
    expect(range(d.thisStart, d.thisEnd)).toHaveLength(
      range(d.prevStart, d.prevEnd).length,
    );
  });

  it("does not let a longer this-window mask a real increase", () => {
    // Flat $0.10/day for 14 days: a correct digest reports 0% change. The old
    // 8-vs-7 comparison would have reported +14.3% out of thin air.
    const flat: CostRow[] = range("2026-07-12", "2026-07-26").map((day) => ({
      day,
      feature: "all",
      provider: "anthropic",
      events: 10,
      cost: 0.1,
    }));
    const d = buildCostDigest(flat, SEND_TIME);
    expect(d.thisTotal).toBeCloseTo(0.7, 6);
    expect(d.prevTotal).toBeCloseTo(0.7, 6);
    expect(d.deltaPct).toBeCloseTo(0, 6);
  });

  it("ignores rows outside both windows, so over-fetching is safe", () => {
    const withNoise: CostRow[] = [
      ...prodRows,
      { day: "2026-06-01", feature: "old", provider: "anthropic", events: 999, cost: 99 },
      { day: "2026-07-27", feature: "future", provider: "anthropic", events: 999, cost: 99 },
    ];
    const d = buildCostDigest(withNoise, SEND_TIME);
    expect(d.thisTotal).toBeCloseTo(1.8746, 4);
    expect(d.prevTotal).toBeCloseTo(2.2605, 4);
  });
});

describe("buildCostDigest — feature breakdown", () => {
  /** Two features: a high-volume cheap one and the low-volume expensive one. */
  const featureRows: CostRow[] = [
    // this window
    { day: "2026-07-20", feature: "shopfront_clone_preclassify", provider: "anthropic", events: 337, cost: 0.8 },
    { day: "2026-07-21", feature: "reddit-intel-classify", provider: "anthropic", events: 6, cost: 1.1 },
    { day: "2026-07-22", feature: "web_analyze", provider: "anthropic", events: 7, cost: 0.03 },
    // prev window
    { day: "2026-07-14", feature: "shopfront_clone_preclassify", provider: "anthropic", events: 300, cost: 0.7 },
    { day: "2026-07-15", feature: "reddit-intel-classify", provider: "anthropic", events: 5, cost: 0.2 },
    { day: "2026-07-16", feature: "retired_thing", provider: "anthropic", events: 40, cost: 0.5 },
  ];

  it("ranks the top features by absolute spend", () => {
    const d = buildCostDigest(featureRows, SEND_TIME);
    expect(d.topFeatures.map((f) => f.feature)).toEqual([
      "reddit-intel-classify",
      "shopfront_clone_preclassify",
      "web_analyze",
    ]);
  });

  it("attaches a per-feature WoW delta", () => {
    const d = buildCostDigest(featureRows, SEND_TIME);
    const classify = d.topFeatures.find((f) => f.feature === "reddit-intel-classify")!;
    expect(classify.prevCost).toBeCloseTo(0.2, 6);
    expect(classify.deltaPct).toBeCloseTo(450, 1);
    const web = d.topFeatures.find((f) => f.feature === "web_analyze")!;
    expect(web.deltaPct).toBeNull(); // no baseline — "new", not infinite
  });

  it("surfaces the expensive-per-event feature that spend-ranking buries", () => {
    const d = buildCostDigest(featureRows, SEND_TIME);
    expect(d.priciestPerEvent?.feature).toBe("reddit-intel-classify");
    expect(d.priciestPerEvent?.costPerEvent).toBeCloseTo(1.1 / 6, 5);
  });

  it("finds the biggest mover even when it is not a top spender", () => {
    const d = buildCostDigest(featureRows, SEND_TIME);
    // reddit-intel-classify moved +$0.90, preclassify +$0.10, retired -$0.50.
    expect(d.biggestMover?.feature).toBe("reddit-intel-classify");
  });

  it("counts a feature that dropped to zero as a mover", () => {
    const droppedOnly: CostRow[] = [
      { day: "2026-07-16", feature: "retired_thing", provider: "anthropic", events: 40, cost: 0.5 },
    ];
    const d = buildCostDigest(droppedOnly, SEND_TIME);
    expect(d.biggestMover?.feature).toBe("retired_thing");
    expect(d.biggestMover?.cost).toBe(0);
    // …but it can't be the priciest-per-event, having spent nothing this week.
    expect(d.priciestPerEvent).toBeNull();
  });

  it("treats a zero-event cost row as unpriceable rather than dividing by zero", () => {
    const d = buildCostDigest(
      [{ day: "2026-07-20", feature: "odd", provider: "x", events: 0, cost: 0.4 }],
      SEND_TIME,
    );
    expect(d.topFeatures[0].costPerEvent).toBeNull();
    expect(d.priciestPerEvent).toBeNull();
  });
});

describe("buildCostDigest — empty and zero-baseline cases", () => {
  it("returns a null delta with no previous spend", () => {
    const d = buildCostDigest(
      [{ day: "2026-07-20", feature: "a", provider: "p", events: 1, cost: 0.5 }],
      SEND_TIME,
    );
    expect(d.prevTotal).toBe(0);
    expect(d.deltaPct).toBeNull();
    expect(formatCostDigest(d, { inboundScanFailures: 0 }).join("\n")).toContain(
      "new spend",
    );
  });

  it("handles a completely empty week", () => {
    const d = buildCostDigest([], SEND_TIME);
    expect(d.thisTotal).toBe(0);
    expect(d.deltaPct).toBeNull();
    const msg = formatCostDigest(d, { inboundScanFailures: 0 }).join("\n");
    expect(msg).toContain("No cost events logged this week.");
    expect(msg).toContain("Delta: —");
  });
});

describe("formatCostDigest", () => {
  it("states both window ranges so future drift is visible in the message", () => {
    const d = buildCostDigest(prodRows, SEND_TIME);
    const msg = formatCostDigest(d, { inboundScanFailures: 0 }).join("\n");
    expect(msg).toContain("2026-07-19…2026-07-25 vs 2026-07-12…2026-07-18");
    expect(msg).toContain("7d each; today excluded as partial");
    expect(msg).toContain("7 days to 2026-07-25 UTC");
  });

  it("reports the corrected delta and a per-day average", () => {
    const d = buildCostDigest(prodRows, SEND_TIME);
    const msg = formatCostDigest(d, { inboundScanFailures: 0 }).join("\n");
    expect(msg).toContain("-17.1%");
    expect(msg).not.toContain("-4.6%");
    expect(msg).toContain("Avg/day: $0.268");
  });

  it("keeps the inbound-scan escalation line", () => {
    const d = buildCostDigest(prodRows, SEND_TIME);
    expect(formatCostDigest(d, { inboundScanFailures: 3 }).join("\n")).toContain(
      "inbound-scan apology replies this week: 3",
    );
    expect(formatCostDigest(d, { inboundScanFailures: 0 }).join("\n")).not.toContain(
      "apology replies",
    );
  });
});

describe("thisWindowTimestamps", () => {
  it("spans the same 7 complete days as the spend window", () => {
    expect(thisWindowTimestamps(SEND_TIME)).toEqual({
      fromInclusive: "2026-07-19T00:00:00.000Z",
      // exclusive — so 07-25 is fully included and the partial 07-26 is not
      toExclusive: "2026-07-26T00:00:00.000Z",
    });
  });
});

describe("buildCostDigest — regression guards found while testing", () => {
  it("omits a feature that spent nothing this week from the top list", () => {
    // Found by the fixture below: a feature present only in the PREVIOUS window
    // was ranked into "Top features this week" at $0.00, because the spend map
    // deliberately carries prev-only features so the mover calculation can see
    // them drop to zero.
    const d = buildCostDigest(
      [
        { day: "2026-07-20", feature: "active", provider: "p", events: 5, cost: 0.3 },
        { day: "2026-07-14", feature: "retired", provider: "p", events: 5, cost: 0.9 },
      ],
      SEND_TIME,
    );
    expect(d.topFeatures.map((f) => f.feature)).toEqual(["active"]);
    // …but it is still visible as the biggest mover, which is the point.
    expect(d.biggestMover?.feature).toBe("retired");
  });
});
