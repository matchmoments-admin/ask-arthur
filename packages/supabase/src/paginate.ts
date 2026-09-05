/**
 * Page through a PostgREST result set instead of silently losing its tail.
 *
 * WHY THIS EXISTS — measured against prod on 2026-08-09, not inferred:
 *
 *   .limit(5000)      -> 1000 rows
 *   .limit(2000)      -> 1000 rows
 *   .range(1000,4999) ->   64 rows   (they exist; they are just never returned)
 *
 * **PostgREST enforces a server-side maximum of 1000 rows per request.** A
 * `.limit(N)` above that is not an error and not a warning — the response is
 * simply short, and every downstream `.length`, `.reduce` and `.filter` is then
 * computed over a truncated set. The July 2026 Clone-Watch edition published
 * "1000 newly-registered copycat domains" on LinkedIn because of exactly this;
 * the real figure was 1064.
 *
 * The failure is especially nasty because the obvious guard does not work:
 *
 *     const rows = await q.limit(5000)          // returns 1000
 *     if (rows.length === 5000) warn(...)       // can NEVER fire
 *
 * A ceiling above 1000 is unreachable, so the guard is decoration. Any
 * "did we truncate?" check must compare against a number the server can
 * actually return — which is what `truncated` below does.
 *
 * ORDER BY IS MANDATORY, not stylistic. Postgres guarantees no stable row order
 * across separate queries, so past page one an unordered `.range()` walk can
 * skip and repeat rows — strictly worse than truncating, because the result is
 * both wrong and irreproducible. Callers build their own query so they own the
 * `.order()`; there is no way to add it here.
 *
 * DON'T REACH FOR THIS WHEN YOU ONLY WANT A TOTAL. `count: "exact", head: true`
 * is not row-capped and costs one round trip — see `readCount()` in
 * apps/web/lib/dashboard/read-count.ts for the safe way to read one.
 */

/** PostgREST's hard server-side ceiling. Not configurable from the client. */
export const POSTGREST_MAX_ROWS = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface FetchAllOptions {
  /**
   * Stop after this many rows and report `truncated: true`. Protects a runaway
   * scan; unlike a `.limit()` above 1000 this ceiling is genuinely reachable,
   * so a guard against it can actually fire.
   */
  maxRows?: number;
  /** Rows per request. Values above the server cap are pointless; clamped. */
  pageSize?: number;
}

export interface FetchAllResult<T> {
  rows: T[];
  /** True when `maxRows` stopped the walk — i.e. rows exist that we did not read. */
  truncated: boolean;
  /** First error encountered; `rows` then holds whatever was read before it. */
  error: { message: string } | null;
}

/**
 * Read every row a query matches, one page at a time.
 *
 * @param buildPage builds the query for one page. MUST include an `.order()` on
 *   a unique or near-unique column — see the note above. Receives inclusive
 *   `from`/`to` bounds to hand straight to `.range(from, to)`.
 *
 * @example
 *   const { rows, truncated } = await fetchAllRows<Row>(
 *     (from, to) =>
 *       sb.from("shopfront_clone_alerts")
 *         .select("id, candidate_domain")
 *         .gte("first_seen_at", startIso)
 *         .order("id", { ascending: true })
 *         .range(from, to),
 *     { maxRows: 20_000 },
 *   );
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: FetchAllOptions = {},
): Promise<FetchAllResult<T>> {
  const pageSize = Math.min(
    options.pageSize ?? POSTGREST_MAX_ROWS,
    POSTGREST_MAX_ROWS,
  );
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { rows, truncated: false, error };

    const page = data ?? [];
    rows.push(...page);

    // maxRows is checked FIRST, and that order is load-bearing.
    //
    // It used to come second, after the short-page return. So whenever the
    // whole result set fitted in one page — fewer than 1,000 rows — the
    // short-page branch returned everything and maxRows was never applied at
    // all. A caller asking for 100 got 976.
    //
    // That is harmless for a caller using maxRows as a safety ceiling, which
    // is why it survived: every existing caller either passes a huge value or
    // re-slices afterwards. It is NOT harmless for a caller using maxRows as a
    // SPEND limit, which is what _embed-backfill.ts did on its first run —
    // asked for 100 rows and got the full 976.
    if (rows.length >= maxRows) {
      return {
        rows: rows.slice(0, maxRows),
        // `truncated` means "rows exist that we did not read". A short page
        // proves there were none, so the flag depends on which condition we
        // are in, not merely on having hit the cap.
        truncated: page.length === pageSize,
        error: null,
      };
    }

    // A short page means the server ran out of matching rows — the only
    // trustworthy end-of-set signal, since the server never tells us the total.
    if (page.length < pageSize) return { rows, truncated: false, error: null };
  }
}
