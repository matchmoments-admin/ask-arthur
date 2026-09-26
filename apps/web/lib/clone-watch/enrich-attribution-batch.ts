/**
 * The attribution enricher's batch loop (#1229 part 1), separated from the
 * Inngest function so the decisions — which rows are looked up, paced,
 * written, skipped, or left for tomorrow — can be tested by calling it. The
 * function file owns only the I/O it injects (lookups, the read-back, the
 * bulk write).
 *
 * WHY ONE STEP. The enricher ran one `enrich-${id}` step per alert: 60 step
 * executions a day, each re-queueing for one of the account's 5 Hobby slots
 * (~30 s under contention, ADR-0019), for ~2 s of lookups apiece. The run took
 * 6m45s trigger→finish on 2026-09-25 and declared a 36-minute finish budget.
 * Now: one in-step budget, rows looked up `concurrency`-wide.
 *
 * WHAT THE PER-ROW STEPS WERE BUYING, AND HOW IT IS KEPT. A per-row step
 * checkpoints completed rows, so a retry never re-pays a lookup. Folding them
 * loses that unless the batch checkpoints itself. Two mechanisms:
 *
 *   1. READ-BACK. The first act of every attempt of the step is to re-read
 *      which of the memoised worklist ids still have `attribution IS NULL`.
 *      Rows a previous attempt already wrote are skipped, not looked up again.
 *   2. CHUNKED FLUSH. Results are written every `flushEvery` rows (and at the
 *      end), not once at the end, so a step killed at the route's maxDuration
 *      loses at most one chunk of lookups. The write RPC only fills
 *      `attribution IS NULL`, so a write that races a retry is a no-op, never
 *      an overwrite.
 *
 * REPLAY SAFETY. Every counter lives inside this call, which runs inside ONE
 * step; the step's return value is what the handler reads. There is no
 * handler-level accumulator for an Inngest replay to reset (the
 * mutually-unsatisfiable-constants lesson: a `let` above a loop of step.runs
 * is re-initialised on every replay).
 *
 * PACING (why 4 wide and ≥3 s apart). The binding vendor limit is whoisjson's
 * 20 requests/MINUTE (whois.ts; its 1,000/month quota is separately held by
 * the `batch` monthly guard at 700). lookupDomainRegistration makes at most
 * ONE whoisjson call per row — only when RDAP produced nothing (22% of rows on
 * 2026-09-25: 13 of 60). Width alone does not bound a rate: a row that
 * short-circuits in ~0.5 s (a TLD with no RDAP server) would let four workers
 * start ~480 rows/min. A 3 s minimum start interval caps starts at 20/min, so
 * whoisjson stays at or under its per-minute cap even if RDAP were down for
 * every row. The same interval keeps each TLD's registry RDAP server at
 * ≤20/min — registries 404 transiently under bursts (rdap.ts, 2026-09-26) —
 * which is about twice the old sequential rate (60 rows in 6m45s ≈ 9/min) and
 * far below anything that tripped. CT (crt.sh, "1 s polite delay"), AbuseIPDB
 * (1,000/day) and the ABR lookup are all bounded by the same start rate.
 * Width 4 exists only so one slow row (worst case ≈ 34 s: RDAP 8 s timeout →
 * rdap.org 8 s → whoisjson 5 s, in parallel with the .au registrant lookup,
 * then the ABR 10 s) does not stall the pace.
 */

import { mapWithConcurrency } from "@askarthur/utils/concurrency";

/** Rows in flight at once. See PACING above. */
export const ENRICH_CONCURRENCY = 4;
/** No two rows STARTED closer than this, across all workers. See PACING. */
export const ENRICH_MIN_START_INTERVAL_MS = 3_000;
/** Results per bulk write. Bounds the lookups lost to a killed step. */
export const ENRICH_FLUSH_EVERY = 10;

export interface EnrichBatchRow {
  id: number;
  candidate_domain: string;
}

/** One row's write: the dossier plus its campaign key (null = leave alone). */
export interface AttributionWrite<A = unknown> {
  id: number;
  attribution: A;
  campaign_key: string | null;
  /** #1253 (v336): when the WHOIS lookup was deferred, the instant to re-ask
   *  it; null / absent = nothing to re-ask. */
  attribution_retry_after?: string | null;
}

export interface EnrichBatchOutcome {
  /** Worklist size handed in (the memoised select). */
  pending: number;
  /** Skipped by the read-back: attribution already written — by a previous
   *  attempt of this step, or by anything else — so no lookup was paid. */
  alreadyEnriched: number;
  /** Rows whose lookups started this attempt. */
  attempted: number;
  /** Rows this attempt's bulk writes landed. */
  written: number;
  /** Lookup threw; row stays attribution IS NULL and re-presents tomorrow. */
  lookupFailed: number;
  /** Looked up, but the chunk write errored; re-presents tomorrow. */
  writeFailed: number;
  /** Looked up and flushed, but the row already carried attribution by the
   *  time the write ran (the RPC's IS NULL guard) — a race, not a loss. */
  writeSkipped: number;
  /** Rows the wall-clock budget stopped before their lookup started. */
  notReachedBudget: number;
  deadlineHit: boolean;
}

export async function runEnrichBatch<A>(args: {
  rows: readonly EnrichBatchRow[];
  budget: { expired(): boolean };
  /**
   * Which of `ids` still need enrichment (attribution IS NULL). Throw on a
   * failed read: proceeding blind would re-pay every lookup a previous attempt
   * already made, and the step's retry is the right response to a DB blip.
   */
  readBack: (ids: number[]) => Promise<Set<number>>;
  /** Look one row up. Expected not to throw (the helpers degrade to null);
   *  a throw is counted as lookupFailed and never aborts the batch. */
  enrich: (row: EnrichBatchRow) => Promise<AttributionWrite<A>>;
  /** Bulk-write a chunk. Returns rows written, or an error message. */
  flush: (
    writes: AttributionWrite<A>[],
  ) => Promise<{ written: number } | { error: string }>;
  onRowError?: (id: number, err: unknown) => void;
  onFlushError?: (ids: number[], message: string) => void;
  concurrency?: number;
  minStartIntervalMs?: number;
  flushEvery?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<EnrichBatchOutcome> {
  const {
    rows,
    budget,
    concurrency = ENRICH_CONCURRENCY,
    minStartIntervalMs = ENRICH_MIN_START_INTERVAL_MS,
    flushEvery = ENRICH_FLUSH_EVERY,
  } = args;
  const sleep =
    args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = args.now ?? Date.now;

  const outcome: EnrichBatchOutcome = {
    pending: rows.length,
    alreadyEnriched: 0,
    attempted: 0,
    written: 0,
    lookupFailed: 0,
    writeFailed: 0,
    writeSkipped: 0,
    notReachedBudget: 0,
    deadlineHit: false,
  };
  if (rows.length === 0) return outcome;

  // (1) Read-back: never re-pay a lookup a previous attempt already wrote.
  const stillNull = await args.readBack(rows.map((r) => r.id));
  const todo = rows.filter((r) => stillNull.has(r.id));
  outcome.alreadyEnriched = rows.length - todo.length;

  let buffer: AttributionWrite<A>[] = [];
  const flushChunk = async (chunk: AttributionWrite<A>[]): Promise<void> => {
    if (chunk.length === 0) return;
    let res: { written: number } | { error: string };
    try {
      res = await args.flush(chunk);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }
    if ("error" in res) {
      outcome.writeFailed += chunk.length;
      args.onFlushError?.(
        chunk.map((w) => w.id),
        res.error,
      );
      return;
    }
    const written = Math.min(Math.max(0, res.written), chunk.length);
    outcome.written += written;
    outcome.writeSkipped += chunk.length - written;
  };

  // The next permitted start time, claimed synchronously by each worker
  // before it sleeps, so two workers can never take the same slot.
  let nextStart = 0;
  let reached = 0;
  await mapWithConcurrency(todo, concurrency, async (row) => {
    if (budget.expired()) return;
    if (minStartIntervalMs > 0) {
      const t = now();
      const slot = Math.max(t, nextStart);
      nextStart = slot + minStartIntervalMs;
      if (slot > t) await sleep(slot - t);
      if (budget.expired()) return;
    }
    reached++;
    outcome.attempted++;
    let write: AttributionWrite<A>;
    try {
      write = await args.enrich(row);
    } catch (err) {
      outcome.lookupFailed++;
      args.onRowError?.(row.id, err);
      return;
    }
    buffer.push(write);
    if (buffer.length >= flushEvery) {
      // Swap before awaiting so a concurrent worker starts a fresh buffer.
      const chunk = buffer;
      buffer = [];
      await flushChunk(chunk);
    }
  });
  await flushChunk(buffer);
  buffer = [];

  outcome.notReachedBudget = todo.length - reached;
  outcome.deadlineHit = outcome.notReachedBudget > 0;
  return outcome;
}
