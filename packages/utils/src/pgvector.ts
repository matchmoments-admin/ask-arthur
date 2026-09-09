/**
 * pgvector wire format, in one place.
 *
 * WHY THIS EXISTS AS A SHARED MODULE. `vectorToPgString` was copied
 * identically into NINE files — six scam-engine Inngest functions, the
 * charity-check ACNC provider, and two apps/web search routes — and
 * `parsePgVector`/`cosineSimilarity` existed once, reachable only through a
 * `__testing` backdoor of which two thirds had no consumer. One home; the
 * deletion test passes strongly (#1132).
 *
 * THE FORMAT. supabase-js serialises a JS array as a JSON array, which
 * PostgREST then sends as Postgres array syntax `{...}` — wrong for vector
 * columns. The unambiguous-everywhere form is the bracketed text `[1,2,3]`,
 * which pgvector accepts on insert/update and emits on read.
 */

/** Serialise for a `vector` column: `[1,2,3]`. */
export function vectorToPgString(vec: readonly number[]): string {
  return "[" + vec.join(",") + "]";
}

/**
 * Parse pgvector's `[1.234,5.678,...]` wire form.
 *
 * Returns null for anything that is not a usable vector, INCLUDING a string
 * that parses to the right shape but the wrong numbers. The previous version
 * was `inner.split(",").map(Number)` with no validation, and every malformed
 * input survived it as a non-empty array:
 *
 *   "[abc,def]"  -> [NaN, NaN]   length 2, passes a `.length > 0` filter
 *   "[]"         -> [0]          Number("") is 0, not NaN
 *
 * Both then poison the caller silently rather than failing. A NaN embedding
 * makes every `sim > bestSim` comparison false — NaN compares false against
 * everything — so a post matches no theme, takes the seed branch, and writes
 * a centroid of `[NaN,NaN,...]` that pgvector rejects on insert. The insert
 * error is caught, warned, and skipped, so the post is skipped on that run
 * and on every run after it. The failure presents as an unexplained orphan,
 * three steps from its cause.
 *
 * Reject rather than propagate: a wrong vector is worse than a missing one,
 * because the caller counts a missing one.
 */
export function parsePgVector(s: string | null | undefined): number[] | null {
  if (!s) return null;
  const inner = s.startsWith("[") ? s.slice(1, -1) : s;
  if (inner.trim() === "") return null;
  const parsed = inner.split(",").map(Number);
  if (!parsed.every(Number.isFinite)) return null;
  return parsed;
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 — "no evidence of similarity" — for
 * a length mismatch or a zero vector rather than NaN, because NaN compares
 * false against every threshold and would silently route a post to the seed
 * branch (see parsePgVector).
 */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
