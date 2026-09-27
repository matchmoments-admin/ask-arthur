import { describe, expect, it } from "vitest";

import { LANES, laneRanWithin } from "../lane-outcome";

// The cooldown read must look up the SAME feature its Lane writes (the roster
// triple), not a hand-typed string: the recheck and issue Lanes each carried a
// literal copy until 2026-09-27. Go-red: reading `.eq("feature", lane)` (the
// Lane id instead of its roster feature) fails the first test.

function fakeSb(row: { created_at: string } | null, seen: { feature?: string }) {
  const chain: Record<string, unknown> = {};
  chain.from = (table: string) => {
    expect(table).toBe("cost_telemetry");
    return chain;
  };
  chain.select = () => chain;
  chain.eq = (col: string, val: string) => {
    if (col === "feature") seen.feature = val;
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => ({ data: row, error: null });
  return chain as never;
}

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

describe("laneRanWithin", () => {
  it("reads the Lane's roster feature", async () => {
    for (const lane of [
      "shopfront-clone-lifecycle-recheck",
      "shopfront-clone-netcraft-issue",
    ] as const) {
      const seen: { feature?: string } = {};
      await laneRanWithin(fakeSb(null, seen), lane, 60_000);
      expect(seen.feature).toBe(LANES[lane].feature);
    }
  });

  it("true inside the window, false outside it", async () => {
    const lane = "shopfront-clone-netcraft-issue";
    expect(await laneRanWithin(fakeSb({ created_at: ago(5_000) }, {}), lane, 60_000)).toBe(true);
    expect(await laneRanWithin(fakeSb({ created_at: ago(120_000) }, {}), lane, 60_000)).toBe(false);
  });

  it("no row (or an unreadable log) lets the run proceed", async () => {
    expect(await laneRanWithin(fakeSb(null, {}), "shopfront-clone-lifecycle-recheck", 60_000)).toBe(false);
  });
});
