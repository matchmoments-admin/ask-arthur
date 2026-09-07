/**
 * Bounded-parallelism helpers.
 *
 * WHY THIS EXISTS AS A SHARED MODULE. Inngest steps hold an account
 * concurrency slot for their whole duration, and this account runs on a 5-slot
 * pool measured at 5/5 in use (2026-09-07, ADR-0019). Anything that awaits once
 * per row inside a step converts row count directly into slot-seconds — the
 * clustering write path did ~3 sequential round trips per post, measured at
 * 0.87s per post in production, which is 7.3 minutes of held slot for a
 * 500-post batch.
 *
 * Serialising is the bug; unbounded `Promise.all` is the other bug. A burst of
 * hundreds of concurrent statements against a hot table is how the 2026-05-09
 * pooler incident started.
 */

/**
 * Default in-flight width for database round trips inside a step.
 *
 * Not 1 (the serialisation this exists to remove) and not unbounded. Eight
 * collapses wall time by roughly an order of magnitude while staying well
 * inside the pooler's connection budget.
 */
export const DB_WRITE_CONCURRENCY = 8;

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Rejections propagate — callers that want per-item tolerance catch inside
 * `fn` and record the failure, which is the pattern every current caller uses.
 * An unhandled fault inside a durable step should fail the step loudly rather
 * than be swallowed here.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, () =>
    (async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        await fn(items[i]!);
      }
    })(),
  );
  await Promise.all(workers);
}

/** Group items by a derived key, preserving insertion order within each group. */
export function groupBy<T, K>(
  items: readonly T[],
  key: (item: T) => K,
): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const existing = out.get(k);
    if (existing) existing.push(item);
    else out.set(k, [item]);
  }
  return out;
}
