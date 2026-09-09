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

/**
 * The outcome of one batched write, in per-ITEM units.
 *
 * WHY ONE SHAPE. Four sites reported the same fact four ways: a typed result
 * with three named counters (clustering), a local `failures` int with a warn
 * (campaign-key backfill), `if (!error) n += 1; continue;` with no log and no
 * counter (kit-pivots — forty lines above a loop #1121 had just fixed for
 * exactly that), and `logger.error; continue;` counted only by absence
 * (brand stewardship). Reading "how much of this run landed?" meant reading
 * the loop. A shared shape makes the question answerable from the summary,
 * and the invariant below makes a silent drop arithmetically visible:
 *
 *     attempted − written − failed  =  items never reached
 *
 * which is non-zero only when something stopped the loop early — a wall-clock
 * budget (`deadlineHit`) or, at a site that says so, an external quota.
 */
export interface WriteOutcome {
  /** Items the write set out to handle, after any idempotency skip. */
  attempted: number;
  /** Items whose write landed. */
  written: number;
  /** Items whose write was tried and did not land — logged at the site. */
  failed: number;
  /**
   * True when a wall-clock budget stopped the write before every item was
   * reached. The remainder is NOT lost — a self-healing worklist selects it
   * next run — but a partial run must not read as a small one.
   */
  deadlineHit: boolean;
}

/** A write that did nothing. Spread it, never mutate it. */
export const NO_WRITES: Readonly<WriteOutcome> = Object.freeze({
  attempted: 0,
  written: 0,
  failed: 0,
  deadlineHit: false,
});

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
