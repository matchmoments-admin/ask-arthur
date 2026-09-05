/**
 * The windowing and mapping are pure so they can be tested; the Supabase read
 * is a thin adapter around them. A Server Component is the hardest place in
 * this codebase to test anything, which is why the logic does not live there.
 */
import { describe, expect, it } from "vitest";

import { computeScamTypeMovement } from "@/lib/scam-type-trend";

const NOW = new Date("2026-09-05T00:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

function rows(spec: [raw: string | null, days: number, count: number][]) {
  return spec.flatMap(([raw, days, count]) =>
    Array.from({ length: count }, () => ({ rawType: raw, at: daysAgo(days) })),
  );
}

describe("computeScamTypeMovement", () => {
  it("counts the two vocabularies as one type", () => {
    // The entire point. `romance` from the analyze path and `romance_scam`
    // from the Reddit path are the same scam; counting them apart under-reports
    // each by the other's share, silently.
    const m = computeScamTypeMovement(
      rows([
        ["romance_scam", 5, 8],
        ["romance", 5, 4],
      ]),
      NOW,
    );
    expect(m).toHaveLength(1);
    expect(m[0].type).toBe("romance");
    expect(m[0].recent).toBe(12);
  });

  it("splits the two windows on the boundary", () => {
    const m = computeScamTypeMovement(
      rows([
        ["phishing", 3, 10],
        ["phishing", 40, 5],
      ]),
      NOW,
    );
    expect(m[0].recent).toBe(10);
    expect(m[0].prior).toBe(5);
    expect(m[0].deltaPct).toBe(100);
  });

  it("drops anything older than both windows", () => {
    const m = computeScamTypeMovement(
      rows([
        ["phishing", 3, 5],
        ["phishing", 200, 500],
      ]),
      NOW,
    );
    expect(m[0].recent).toBe(5);
    expect(m[0].prior).toBe(0);
  });

  it("excludes 'not a scam' rather than bucketing it", () => {
    // `informational` (251 rows in production) and `none` are judgements that
    // a post is NOT a scam. Counting them as a category would inflate every
    // total with posts we decided were not scams.
    const m = computeScamTypeMovement(
      rows([
        ["informational", 5, 40],
        ["none", 5, 10],
        ["phishing", 5, 3],
      ]),
      NOW,
    );
    expect(m.map((x) => x.type)).toEqual(["phishing"]);
  });

  it("reports a new type as null rather than an infinite percentage", () => {
    const m = computeScamTypeMovement(rows([["sextortion", 3, 12]]), NOW);
    expect(m[0].prior).toBe(0);
    expect(m[0].deltaPct).toBeNull();
  });

  it("sorts by movement, not by volume", () => {
    // A type going 18 -> 26 matters more than `other` sitting flat at 170.
    // Sorting by volume would bury exactly the row worth acting on.
    const m = computeScamTypeMovement(
      rows([
        ["other", 3, 170],
        ["other", 40, 170],
        ["sextortion", 3, 26],
        ["sextortion", 40, 18],
      ]),
      NOW,
    );
    expect(m[0].type).toBe("sextortion");
    expect(m[0].deltaPct).toBe(44);
    expect(m[1].type).toBe("other");
  });

  it("sinks a category too small for its percentage to mean anything", () => {
    // 1 -> 3 is +200% and is noise. It must not outrank a real move, but it
    // must still be listed — hiding a category is how a rising one stays
    // invisible.
    const m = computeScamTypeMovement(
      rows([
        ["rental_scam", 3, 3],
        ["rental_scam", 40, 1],
        ["phishing", 3, 60],
        ["phishing", 40, 50],
      ]),
      NOW,
    );
    expect(m[0].type).toBe("phishing");
    expect(m.map((x) => x.type)).toContain("rental");
    expect(m.find((x) => x.type === "rental")!.readable).toBe(false);
  });

  it("ignores an unparseable timestamp instead of counting it as now", () => {
    // new Date("nonsense").getTime() is NaN, and NaN >= recentFrom is false —
    // but only because the comparison happens to fail closed. Asserted so a
    // future refactor cannot turn it into a silent "count everything".
    const m = computeScamTypeMovement(
      [{ rawType: "phishing", at: "not a date" }],
      NOW,
    );
    expect(m).toEqual([]);
  });
});
