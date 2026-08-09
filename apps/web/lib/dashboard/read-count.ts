/**
 * Honest reading of a Supabase `count: "exact", head: true` query.
 *
 * WHY THIS EXISTS — measured against prod on 2026-08-09, not inferred:
 *
 *   | query                          | count | error            | status |
 *   |--------------------------------|-------|------------------|--------|
 *   | real table, no matching rows   | 0     | null             | 200    |
 *   | table that does not exist      | null  | NULL             | 204    |
 *   | column that does not exist     | null  | error, code undef| 400    |
 *   | bad table, ordinary (non-head) | —     | PGRST205         | 404    |
 *
 * The second row is the trap. A HEAD response carries no body, so supabase-js
 * has nothing to parse an error out of and hands back `error: null` with a null
 * count. **On a head-count query, checking `error` is structurally blind**: the
 * failure arrives as a silent null, which `?? 0` then renders as a confident
 * zero — the exact defect the admin error-band sweep (#945) exists to remove.
 *
 * Because a successful count is always a number (0 when empty), `count === null`
 * is the reliable signal. Every count site in the console goes through here so
 * the distinction lives in one place instead of being re-derived — wrongly —
 * per call site.
 */

export interface CountResult {
  count: number | null;
  error: { message?: string; code?: string } | null;
}

/**
 * @returns the measured count, or `null` when the read did not produce one.
 *          Never coalesce the null to 0 — that is the whole point.
 */
export function readCount(
  res: CountResult,
  label: string,
  loadErrors: string[],
): number | null {
  if (res.error || res.count === null) {
    loadErrors.push(label);
    return null;
  }
  return res.count;
}

/** Render an unmeasured count as an em dash rather than a confident zero. */
export function fmtCount(n: number | null): string {
  return n === null ? "—" : n.toLocaleString();
}

/** True only when the value was actually measured AND it breaches. */
export function over(n: number | null, threshold: number): boolean {
  return n !== null && n > threshold;
}
