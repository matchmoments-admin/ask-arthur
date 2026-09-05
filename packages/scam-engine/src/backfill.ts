/**
 * The safety invariants of spending money in a loop.
 *
 * WHY THIS EXISTS.
 *
 * `_take-backfill.ts` and `_classify-backfill.ts` are two operator scripts
 * doing unrelated work — one writes takes with Haiku, the other classifies
 * posts with Sonnet. They were written weeks apart. They shared FOUR defects,
 * each found independently:
 *
 *   1. `--dry` still called the model. The flag guarded the writes, not the
 *      spend, so a dry run paid in full and discarded the result. Measured on
 *      a real run: US$0.14.
 *   2. The same guard skipped `logCost`, so that spend never reached
 *      cost_telemetry, the daily cap or the weekly digest. Untracked spend is
 *      the worse half — even a wanted call has to be recorded.
 *   3. No per-batch isolation. One malformed model response ended the run. It
 *      did: batch 118 of 133, 382 rows abandoned, while the printed totals
 *      still read like a finished job.
 *   4. A partial run reported like a complete one — same exit code, same
 *      final line, nothing to distinguish "done" from "stopped early".
 *
 * Four identical mistakes in two files is not two bugs. It is one missing
 * Module: nobody owned "walk a worklist, in batches, spending money", so each
 * script re-derived the policy and each got it wrong in the same places.
 *
 * WHAT THIS OWNS: the brake check, the dry-run gate placed BEFORE any spend,
 * per-batch isolation, unconditional cost logging on every path that spends,
 * and making a partial run loud. None of these are optional and none can be
 * skipped by a flag.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: what the worklist is, and what a batch
 * does. Both are genuinely domain-specific — one script pages `feed_items` and
 * calls a classifier, the other pages `reddit_post_intel` and calls a writer.
 * Pulling those in would make this a framework rather than a policy.
 *
 * DELETION TEST: delete it and the brake check, the dry gate, the try/catch,
 * the logCost call and the partial-run exit reappear in every operator script
 * that spends — which is exactly the state it was written from. It
 * concentrates.
 *
 * Two adapters today, which is what makes the seam real rather than
 * hypothetical. The four brand backfill scripts deliberately do NOT use it:
 * they make no paid calls, so none of these invariants apply to them.
 */
import { isFeatureBraked, logCost } from "./cost-log";

export interface BackfillBatchResult {
  /** What this batch actually cost. Logged verbatim; do not round. */
  costUsd: number;
  /** Tokens, calls, or whatever `units` means for this provider. */
  units: number;
  /** Merged into the cost_telemetry metadata alongside `via`. */
  metadata?: Record<string, unknown>;
  /** Appended to the batch's progress line, e.g. "ready 21 · suppressed 4". */
  summary?: string;
}

export interface BackfillRunOptions<T> {
  /**
   * Short identifier for this run. Printed, and stored as `via` in the cost
   * metadata so a backfill's spend can be told apart from the cron's.
   */
  label: string;
  /** `feature_brakes` key. Checked once, before anything is spent. */
  brakeFeature: string;
  /** `cost_telemetry.feature` tag. Use the SAME tag as the live path. */
  costFeature: string;
  provider: string;
  operation: string;
  /**
   * Measured cost per item, for the dry-run projection only. Never used to
   * report actual spend — that always comes from the batch result.
   */
  usdPerItem: number;
  items: T[];
  batchSize: number;
  dryRun: boolean;
  runBatch: (batch: T[], batchNumber: number) => Promise<BackfillBatchResult>;
}

export interface BackfillRunResult {
  processed: number;
  batchFailures: number;
  totalCostUsd: number;
  /** True when the brake or --dry stopped the run before any spend. */
  skipped: boolean;
}

export async function runSpendingBackfill<T>(
  opts: BackfillRunOptions<T>,
): Promise<BackfillRunResult> {
  const idle: BackfillRunResult = {
    processed: 0,
    batchFailures: 0,
    totalCostUsd: 0,
    skipped: true,
  };

  // The brake first, before the dry projection even — an operator should be
  // told the feature is paused rather than shown a cost estimate for a run
  // that would refuse to start.
  if (await isFeatureBraked(opts.brakeFeature)) {
    console.log(
      `feature_brakes.${opts.brakeFeature} is engaged — refusing to spend.`,
    );
    return idle;
  }

  if (opts.items.length === 0) {
    console.log(`${opts.label}: nothing to do.`);
    return idle;
  }

  // The dry gate sits HERE, above runBatch, and that placement is the whole
  // point. Both scripts had it one step lower, guarding the writes while the
  // model call went ahead and charged for a result nobody kept.
  if (opts.dryRun) {
    console.log(
      `DRY — no model call. ${opts.items.length} items would cost about ` +
        `US$${(opts.items.length * opts.usdPerItem).toFixed(2)} at the measured rate.`,
    );
    return idle;
  }

  let processed = 0;
  let batchFailures = 0;
  let totalCostUsd = 0;
  const batchCount = Math.ceil(opts.items.length / opts.batchSize);

  for (let i = 0; i < opts.items.length; i += opts.batchSize) {
    const batch = opts.items.slice(i, i + opts.batchSize);
    const n = i / opts.batchSize + 1;

    let out: BackfillBatchResult;
    try {
      out = await opts.runBatch(batch, n);
    } catch (e) {
      // A batch is independent of every other batch. The correct response to
      // one failing is to record it and keep going.
      batchFailures += 1;
      console.error(
        `  batch ${n}: FAILED (${batch.length} items left for a later run) — ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      continue;
    }

    totalCostUsd += out.costUsd;
    processed += batch.length;

    // Unconditional, and after the call rather than after the write: by this
    // line the money is already gone. There is deliberately no option that
    // skips it.
    await logCost({
      feature: opts.costFeature,
      provider: opts.provider,
      operation: opts.operation,
      units: out.units,
      estimatedCostUsd: out.costUsd,
      metadata: { ...(out.metadata ?? {}), via: opts.label },
    });

    console.log(
      `  batch ${n}: ${out.summary ?? `${batch.length} items`} · US$${out.costUsd.toFixed(4)}`,
    );
  }

  console.log(
    `\n${opts.label} — ${processed} processed · US$${totalCostUsd.toFixed(4)}`,
  );

  // Loud, and a non-zero exit. A partial run that reports like a complete one
  // is how 382 rows went missing without anyone noticing.
  if (batchFailures > 0) {
    console.error(
      `\n${batchFailures} of ${batchCount} batches failed. Re-run the same ` +
        `command — the worklist is re-selected, so it picks up where this left off.`,
    );
    process.exitCode = 1;
  }

  return { processed, batchFailures, totalCostUsd, skipped: false };
}
