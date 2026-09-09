import { describe, expect, it } from "vitest";

import {
  DB_WRITE_CONCURRENCY,
  groupBy,
  mapWithConcurrency,
  NO_WRITES,
} from "../concurrency";

describe("mapWithConcurrency", () => {
  it("never exceeds the requested width", async () => {
    // The whole point. Serialising converts row count into slot-seconds;
    // unbounded Promise.all is how the 2026-05-09 pooler incident started.
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 50 }, (_, i) => i),
      8,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
    );
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1); // and it really is parallel
  });

  it("visits every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles an empty list and a width wider than the list", async () => {
    await expect(
      mapWithConcurrency([], 8, async () => {}),
    ).resolves.toBeUndefined();
    let n = 0;
    await mapWithConcurrency([1], 100, async () => {
      n++;
    });
    expect(n).toBe(1);
  });

  it("propagates a rejection rather than swallowing it", async () => {
    // Callers that want per-item tolerance catch inside fn and count the
    // failure. A fault that reaches here should fail the step loudly.
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("treats a width below 1 as serial rather than hanging", async () => {
    let n = 0;
    await mapWithConcurrency([1, 2, 3], 0, async () => {
      n++;
    });
    expect(n).toBe(3);
  });
});

describe("groupBy", () => {
  it("collapses many items onto few keys", () => {
    // The property the campaign-key backfill relies on: round trips scale with
    // distinct KEYS, not with rows.
    const rows = [
      { id: 1, k: "a" },
      { id: 2, k: "b" },
      { id: 3, k: "a" },
      { id: 4, k: "a" },
    ];
    const g = groupBy(rows, (r) => r.k);
    expect(g.size).toBe(2);
    expect(g.get("a")!.map((r) => r.id)).toEqual([1, 3, 4]);
    expect(g.get("b")!.map((r) => r.id)).toEqual([2]);
  });

  it("returns an empty map for no items", () => {
    expect(groupBy([], (x) => x).size).toBe(0);
  });
});

describe("NO_WRITES", () => {
  it("is a complete, frozen Write Outcome", () => {
    expect(NO_WRITES).toEqual({
      attempted: 0,
      written: 0,
      failed: 0,
      deadlineHit: false,
    });
    expect(Object.isFrozen(NO_WRITES)).toBe(true);
  });
});

describe("DB_WRITE_CONCURRENCY", () => {
  it("is neither serial nor unbounded", () => {
    expect(DB_WRITE_CONCURRENCY).toBeGreaterThan(1);
    expect(DB_WRITE_CONCURRENCY).toBeLessThanOrEqual(16);
  });
});
