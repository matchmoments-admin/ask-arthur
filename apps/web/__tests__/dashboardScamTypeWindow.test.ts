/**
 * The window must be APPLIED, not merely accepted.
 *
 * `getScamTypeBreakdown` used to be `(_days = 30)` — underscored to silence the
 * linter — with no date filter anywhere in the query. `app/app/page.tsx` passed
 * 30 and the card captioned it "Last 30 days · by volume" plus a "30d" chip. So
 * a parameter was accepted, discarded, and a caption asserted something false on
 * the strength of it.
 *
 * Nothing type-checks that. The signature was correct, the caller was correct,
 * the caption was correct English — only the behaviour was wrong. So the
 * assertion has to be behavioural: two different windows over the same data must
 * produce different results.
 *
 * This is a class the repo has fixed twice before (#941 findings 1 and 10, both
 * with post-mortems left in the source). It reached two more live surfaces
 * anyway, which is the argument for a test rather than another comment.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

/** Rows shaped like the PostgREST embed, dated relative to now. */
function row(daysAgo: number, label: string) {
  return {
    intent_label: label,
    feed_items: {
      source_created_at: new Date(
        Date.now() - daysAgo * 86_400_000,
      ).toISOString(),
    },
  };
}

const ALL_ROWS = [
  ...Array.from({ length: 5 }, () => row(2, "phishing")),
  ...Array.from({ length: 3 }, () => row(2, "romance_scam")),
  // outside a 7-day window, inside a 90-day one
  ...Array.from({ length: 40 }, () => row(40, "phishing")),
  // never counted: not a scam type
  ...Array.from({ length: 9 }, () => row(2, "informational")),
  // never counted: excluded from the ranking as uninformative
  ...Array.from({ length: 50 }, () => row(2, "other")),
];

/** Captures the `.gte()` bound so the test can prove a filter was applied. */
let capturedSince: string | null = null;

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ from: () => builder() }),
}));

vi.mock("@askarthur/supabase/paginate", () => ({
  fetchAllRows: async (
    build: (from: number, to: number) => Promise<{ data: unknown }>,
  ) => {
    const res = await build(0, 999);
    return { rows: (res as { data: unknown[] }).data, truncated: false, error: null };
  },
}));

function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "order", "range"]) {
    b[m] = () => b;
  }
  b.gte = (_col: string, value: string) => {
    capturedSince = value;
    return b;
  };
  // `range` resolves the query
  b.range = () => ({
    data: ALL_ROWS.filter(
      (r) =>
        new Date(r.feed_items.source_created_at).getTime() >=
        new Date(capturedSince!).getTime(),
    ),
  });
  return b;
}

const { getScamTypeBreakdown } = await import("@/lib/dashboard");

describe("getScamTypeBreakdown applies its window", () => {
  beforeEach(() => {
    capturedSince = null;
  });

  it("filters on a date at all", async () => {
    await getScamTypeBreakdown(30);
    expect(
      capturedSince,
      "no date bound reached the query — the window parameter is being " +
        "accepted and ignored, which is exactly the bug this file exists for",
    ).not.toBeNull();
  });

  it("returns fewer rows for a narrower window", async () => {
    // THE assertion. Under the old code both calls returned identical
    // all-time counts and every other test would still have passed.
    const wide = await getScamTypeBreakdown(90);
    const narrow = await getScamTypeBreakdown(7);

    const widePhishing = wide.find((r) => r.category === "phishing")!.count;
    const narrowPhishing = narrow.find((r) => r.category === "phishing")!.count;

    expect(widePhishing).toBe(45);
    expect(narrowPhishing).toBe(5);
    expect(narrowPhishing).toBeLessThan(widePhishing);
  });

  it("counts the two vocabularies as one category", async () => {
    // romance_scam (Reddit) and romance (analyze) are the same scam; tallying
    // them apart under-reports each by the other's share.
    const out = await getScamTypeBreakdown(7);
    expect(out.find((r) => r.category === "romance")?.count).toBe(3);
    expect(out.some((r) => r.category === "romance_scam")).toBe(false);
  });

  it("excludes 'not a scam' rather than bucketing it", async () => {
    const out = await getScamTypeBreakdown(7);
    expect(out.some((r) => r.category === "informational")).toBe(false);
  });

  it("excludes 'other' from the ranking", async () => {
    // 50 rows, more than any real category — it would lead every chart while
    // telling a reader nothing. The caption says "categorised" to match.
    const out = await getScamTypeBreakdown(7);
    expect(out.some((r) => r.category === "other")).toBe(false);
  });

  it("takes percentages over the categorised total, matching the caption", async () => {
    const out = await getScamTypeBreakdown(7);
    const sum = out.reduce((n, r) => n + r.pct, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(2); // rounding only
  });
});
