// Step Budget — the wall-clock allowance for work inside one Inngest run.
//
// There are TWO bounds, and confusing them is the defect this module exists
// to make impossible (CONTEXT.md → Step Budget):
//
//   - INSIDE one step.run the bound is the route's `maxDuration`. Exceeding it
//     is not a slow run: Vercel kills the request, Inngest reports "HTTP 504
//     before the SDK responded, no step output was produced", and the retry
//     redoes identical work and dies identically (2026-09-07, the clustering
//     write phase at 0.87 s/post: ~435 s needed against 300 s).
//   - ACROSS step boundaries the bound is `timeouts.finish`. Exceeding it is
//     worse: Inngest cancels the run silently — no retry, no error, no
//     telemetry (#1069: 44 of 51 preclassify runs cancelled at exactly
//     start+2m; eighteen weaponised brand alerts lost across two episodes).
//
// A budget comes from one of two constructors, one per bound. There is no
// `kind` flag to pick: the in-step one requires a `step`, the spanning one
// requires an `event`. You cannot choose the wrong bound silently.
//
// CLOCK ORIGIN is the whole content of this module.
//
//   - A spanning budget measures from `event.ts` — never from handler entry,
//     because Inngest re-executes the handler from the top at every step
//     boundary, so a Date.now() captured there resets on every replay and the
//     guard never fires. Four clone-watch functions ran that way for months,
//     each behind a comment describing protection it was not providing (#1124).
//   - An in-step budget measures from STEP entry, by construction: the only way
//     to obtain one is inside budgetedStep's callback, and capturing the clock
//     is the callback's first act. Before this module, persistAssignments
//     defaulted its own origin to "now" — after cluster-batch had already
//     loaded 500 posts and 500 1024-dim centroids and run the matcher — so the
//     240 s it believed it had was measured from the wrong place, and the
//     drift test certified a relationship that was not the one getting the run
//     killed.
//
// DEGRADED MODE, decided rather than left to a `?? 0`. When `event.ts` is
// unusable a spanning budget falls back to a clock captured at construction,
// warns ONCE, and reports `degraded: true`. Not fail-open (a confident zero is
// the defect being fixed — #1129 A1); not fail-closed (halting every cron in
// the fleet on an SDK regression). A segment clock still bounds the current
// replay, which is strictly safer than never firing. NOTE the warn goes to
// whatever logger the caller passes — for the clone-watch functions that is
// the console-backed `@askarthur/utils/logger`, which has no Axiom transport;
// anything that must be queryable should carry `budget.degraded` into the
// function's own summary.
//
// INNGEST DETERMINISM: nothing here mints a step id. The Date.now() reads feed
// deadline arithmetic only.

import type { Jsonify } from "inngest/types";

import { elapsedSinceTrigger } from "./with-axiom-logging";

/**
 * The Inngest route's declared `maxDuration`, in seconds.
 *
 * THIS IS A COPY of `export const maxDuration = 300` in
 * apps/web/app/api/inngest/route.ts, and it is only safe because a test
 * enforces the copy. scam-engine cannot import from apps/web (wrong dependency
 * direction) and Next.js requires `maxDuration` to be a statically analysable
 * literal, so the number genuinely has to exist twice.
 * apps/web/__tests__/inngestMaxDurationDrift.test.ts reads the literal out of
 * the route and fails if the two disagree. It is the ONE scam-engine copy;
 * per-function budgets derive from it through budgetedStep's ceiling rather
 * than restating it.
 */
export const ROUTE_MAX_DURATION_S = 300;

/**
 * Share of maxDuration an in-step budget may claim. The remainder is headroom:
 * the wave in flight has to finish, the step's return value has to be written,
 * and the handler has to return, all before Vercel's hard kill.
 */
export const IN_STEP_BUDGET_SHARE = 0.8;

/** The ceiling budgetedStep enforces. Above this a "budget" is not a budget. */
export const MAX_IN_STEP_WALL_CLOCK_MS = Math.floor(
  ROUTE_MAX_DURATION_S * 1000 * IN_STEP_BUDGET_SHARE,
);

export type StepBudget = {
  /** Which bound this budget is measured against. */
  readonly kind: "spanning" | "in-step";
  /** Absolute epoch ms after which `expired()` is true. */
  readonly deadlineAt: number;
  /** True when event.ts was unusable and the origin is a segment clock. */
  readonly degraded: boolean;
  expired(): boolean;
  remainingMs(): number;
};

/**
 * What a consumer of a budget needs. Functions that only CHECK a budget
 * (persistAssignments) depend on this rather than on a constructor, so a test
 * can hand them `{ expired: () => true, remainingMs: () => 0 }` and exercise
 * the already-expired path without faking time.
 */
export type BudgetClock = Pick<StepBudget, "expired" | "remainingMs">;

function makeBudget(
  kind: StepBudget["kind"],
  deadlineAt: number,
  degraded: boolean,
): StepBudget {
  return {
    kind,
    deadlineAt,
    degraded,
    expired: () => Date.now() >= deadlineAt,
    remainingMs: () => Math.max(0, deadlineAt - Date.now()),
  };
}

function assertPositive(wallClockMs: number, where: string): void {
  if (!Number.isFinite(wallClockMs) || wallClockMs <= 0) {
    throw new Error(
      `${where}: wallClockMs must be a positive number, got ${wallClockMs}`,
    );
  }
}

/**
 * A budget for a loop that awaits `step.run` per item — it spans step
 * boundaries, so it is bounded by the function's `timeouts.finish` and its
 * clock is `event.ts`, which is set when the run is triggered and survives
 * replay.
 *
 * `wallClockMs` should be the function's own `*_WALL_CLOCK_MS` constant, kept
 * in the function file: inngestFinishBudgets.test.ts sums those constants
 * into the finish-timeout floor, and hiding them here would blind the ADR's
 * own enforcement.
 */
export function spanningBudget(
  ctx: { event?: { ts?: number } | undefined },
  wallClockMs: number,
  log: { warn: (message: string, meta?: Record<string, unknown>) => void },
): StepBudget {
  assertPositive(wallClockMs, "spanningBudget");
  const ts = ctx.event?.ts;
  // elapsedSinceTrigger is the single home for "is ts usable" (finite,
  // positive, not in the future); null means degrade.
  if (elapsedSinceTrigger(ctx) === null || typeof ts !== "number") {
    log.warn(
      "step-budget: event.ts unusable — spanning budget degraded to a segment clock",
      { ts: ts ?? null, wallClockMs },
    );
    return makeBudget("spanning", Date.now() + wallClockMs, true);
  }
  return makeBudget("spanning", ts + wallClockMs, false);
}

/** The one method of Inngest's step tools this module needs. */
type StepRunner = {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
};

/**
 * Run ONE step whose body is bounded by the route's `maxDuration`, handing the
 * body a budget whose clock starts at step entry.
 *
 * This is the only way to obtain an in-step budget, which is the point: the
 * origin cannot be invented three files away by a default parameter.
 *
 * Throws — synchronously, before the step is even scheduled — if `wallClockMs`
 * exceeds the ceiling. That is a constant misconfiguration, so it fails on the
 * first invocation in dev or test rather than as a 504 in production.
 */
export function budgetedStep<T>(
  step: StepRunner,
  name: string,
  wallClockMs: number,
  fn: (budget: StepBudget) => Promise<T>,
): Promise<Jsonify<T>> {
  assertPositive(wallClockMs, `budgetedStep("${name}")`);
  if (wallClockMs > MAX_IN_STEP_WALL_CLOCK_MS) {
    throw new Error(
      `budgetedStep("${name}"): ${wallClockMs}ms exceeds the in-step ceiling of ` +
        `${MAX_IN_STEP_WALL_CLOCK_MS}ms (${IN_STEP_BUDGET_SHARE} × the route's ` +
        `${ROUTE_MAX_DURATION_S}s maxDuration). Vercel kills the request before ` +
        `a budget that size can fire.`,
    );
  }
  return step.run(name, () =>
    fn(makeBudget("in-step", Date.now() + wallClockMs, false)),
  ) as Promise<Jsonify<T>>;
}
