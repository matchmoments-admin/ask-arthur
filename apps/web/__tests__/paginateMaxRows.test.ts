/**
 * `maxRows` must be honoured even when the whole result set fits in one page.
 *
 * It was not. The short-page return came first:
 *
 *     if (page.length < pageSize) return { rows, ... };   // returns EVERYTHING
 *     if (rows.length >= maxRows) { ... slice ... }       // never reached
 *
 * So any result set under PostgREST's 1,000-row page size ignored the cap
 * entirely. That survived because every existing caller used maxRows as a
 * safety ceiling — a huge number, or re-sliced afterwards — and a ceiling that
 * fails open looks identical to one that was never hit.
 *
 * It stops being harmless the moment a caller uses maxRows as a SPEND limit.
 * `_embed-backfill.ts` did exactly that on its first run: asked for 100 rows,
 * received all 976, and would have paid for 876 it never requested had the
 * provider key been present.
 */
import { describe, expect, it } from "vitest";

import { fetchAllRows } from "@askarthur/supabase/paginate";

const PAGE = 1000;

/** A fake PostgREST that serves `total` rows, one page at a time. */
function server(total: number) {
  const calls: [number, number][] = [];
  const build = async (from: number, to: number) => {
    calls.push([from, to]);
    const rows = [];
    for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i });
    return { data: rows, error: null };
  };
  return { build, calls };
}

describe("fetchAllRows maxRows", () => {
  it("caps a result set that fits in a single page", () => {
    // The exact shape that bit: 976 rows available, 100 asked for.
    const { build } = server(976);
    return fetchAllRows<{ i: number }>(build, { maxRows: 100 }).then((r) => {
      expect(r.rows).toHaveLength(100);
    });
  });

  it("caps a result set that spans pages", async () => {
    const { build } = server(2_500);
    const r = await fetchAllRows<{ i: number }>(build, { maxRows: 1_200 });
    expect(r.rows).toHaveLength(1_200);
  });

  it("returns everything when maxRows is not reached", async () => {
    const { build } = server(40);
    const r = await fetchAllRows<{ i: number }>(build, { maxRows: 100 });
    expect(r.rows).toHaveLength(40);
    expect(r.truncated).toBe(false);
  });

  it("keeps rows in order after capping", async () => {
    // The cap must take the FIRST n, not an arbitrary n — callers order the
    // query deliberately (newest first, or by id for stable pagination).
    const { build } = server(500);
    const r = await fetchAllRows<{ i: number }>(build, { maxRows: 10 });
    expect(r.rows.map((x) => x.i)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("does not claim truncation when the server had nothing more", async () => {
    // `truncated` means "rows exist that we did not read". Hitting the cap on
    // a short page means we read every row there was and then trimmed — the
    // distinction matters to a caller deciding whether to run again.
    const { build } = server(50);
    const r = await fetchAllRows<{ i: number }>(build, { maxRows: 50 });
    expect(r.rows).toHaveLength(50);
    expect(r.truncated).toBe(false);
  });

  it("claims truncation when rows really were left unread", async () => {
    const { build } = server(5_000);
    const r = await fetchAllRows<{ i: number }>(build, { maxRows: PAGE });
    expect(r.truncated).toBe(true);
  });

  it("stops reading once the cap is met", async () => {
    // A spend limit that still pays to read the rest is only half a limit.
    const { build, calls } = server(10_000);
    await fetchAllRows<{ i: number }>(build, { maxRows: PAGE });
    expect(calls).toHaveLength(1);
  });
});
