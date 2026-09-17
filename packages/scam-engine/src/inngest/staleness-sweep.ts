// Staleness Sweep — the one loop that drains a bounded-batch staleness RPC
// (v308: mark_stale_urls / mark_stale_ips / mark_stale_crypto_wallets) inside
// a single in-step budget.
//
// The three feed-staleness crons used to be three shapes: IPs looped a batched
// RPC with a MAX_BATCHES backstop that its own comment admitted was "not a
// within-budget guarantee"; URLs and wallets issued one unbounded UPDATE. Both
// shapes were cancelled at the 4 m finish for a week (#1156) — a cancelled run
// gets no retry, no error and no telemetry, and an unbounded UPDATE cancelled
// mid-flight rolls back entirely, so URL staleness silently stopped on Sep 13.
//
// Interface: a budget clock, a batch caller, and the batch size. The loop runs
// batches while the clock has time and the previous batch was full; it never
// throws for "ran out of time" — it returns `drained: false` and the next tick
// carries on, because every batch is its own committed transaction. What it
// does NOT own: the clock's origin. Callers obtain the clock from
// `budgetedStep` in their own file so the wall-clock literal stays next to the
// createFunction where inngestFinishBudgets.test.ts and
// inngestMaxDurationDrift.test.ts can see it.

import { logger } from "@askarthur/utils/logger";

import type { BudgetClock } from "./step-budget";

/** The subset of a Supabase service client the batch adapter needs. */
export interface StalenessRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: unknown;
    error: {
      message: string;
      code?: string;
      details?: string | null;
      hint?: string | null;
    } | null;
  }>;
}

/**
 * Adapter from one v308 staleness RPC call to a batch result. Lives here so
 * the RPC error is logged by its structured fields in exactly one place — a
 * PostgrestError stringifies to "[object Object]", which masked the real
 * cause of the IP sweep's failures for weeks.
 */
export function stalenessRpcBatch(
  client: StalenessRpcClient,
  rpcName: string,
  args: { p_stale_days: number; p_limit: number },
): () => Promise<StalenessBatchResult> {
  return async () => {
    const { data, error } = await client.rpc(rpcName, args);
    if (error) {
      logger.error(`${rpcName} failed`, {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      throw new Error(`${rpcName} RPC failed: ${error.message}`);
    }
    const count = (data as { deactivated_count?: number } | null)
      ?.deactivated_count;
    return { deactivated: typeof count === "number" ? count : 0 };
  };
}

export interface StalenessBatchResult {
  /** Rows deactivated by this batch; the RPC's `deactivated_count`. */
  deactivated: number;
}

export interface StalenessSweepArgs {
  /** In-step budget from `budgetedStep` — checked BEFORE each batch. */
  budget: BudgetClock;
  /** One RPC call = one committed batch. Throw on RPC error. */
  runBatch: () => Promise<StalenessBatchResult>;
  /** The RPC's p_limit; a batch shorter than this means the stale set is drained. */
  batchLimit: number;
  /** Runaway backstop, not a within-budget guarantee. Default 200. */
  maxBatches?: number;
}

export interface StalenessSweepResult {
  deactivated: number;
  batches: number;
  /** True when the last batch was short — nothing stale remains. */
  drained: boolean;
  /** True when the loop stopped because the budget expired (tail drains next tick). */
  budgetExpired: boolean;
}

export async function runStalenessSweep(
  args: StalenessSweepArgs,
): Promise<StalenessSweepResult> {
  const maxBatches = args.maxBatches ?? 200;
  if (!Number.isInteger(args.batchLimit) || args.batchLimit <= 0) {
    throw new Error(
      `runStalenessSweep: batchLimit must be a positive integer, got ${args.batchLimit}`,
    );
  }
  let deactivated = 0;
  let batches = 0;
  let drained = false;
  let budgetExpired = false;

  while (batches < maxBatches) {
    if (args.budget.expired()) {
      budgetExpired = true;
      break;
    }
    const batch = await args.runBatch();
    batches++;
    deactivated += batch.deactivated;
    if (batch.deactivated < args.batchLimit) {
      drained = true;
      break;
    }
  }

  return { deactivated, batches, drained, budgetExpired };
}
