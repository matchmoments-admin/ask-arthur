// withAxiomLogging — Inngest function observability HOF (#514).
//
// Wraps an Inngest handler to emit exactly the lifecycle signals the #515
// dashboards/monitors need: `fn.start` (INFO, sampled), `fn.complete` (WARN,
// always ships, elapsedSinceTriggerMs + finalSegmentMs + attempt) and
// `fn.error` (ERROR, always ships). See elapsedSinceTrigger below for why
// there are two numbers and why the single `durationMs` they replaced was
// structurally wrong; fn.complete is WARN rather than INFO because it fires
// exactly once per logical run and is therefore the only true run counter this
// wrapper emits — at INFO's 10% sampling a low-frequency cron was
// indistinguishable from one that never ran.
//
// It threads the same
// `requestId` that flows through middleware (#490) and /api/analyze (#491)
// when the triggering event carries one, so an analyze → Inngest fan-out is
// joinable on a single id. Cron functions have no event.data.requestId, so we
// fall back to the Inngest `runId` (stable across a run's step replays).
//
// FREE-TIER HYGIENE (the hard constraint — #514/#515 budget is 400 GB/mo):
//   1. Master kill switch: getLogger() is a no-op until FF_AXIOM_ENABLED=true,
//      so this ships dark and costs zero ingest until the #515 flip.
//   2. Sampling decided ONCE per invocation: getLogger buckets by requestId/
//      runId deterministically, so every line for a run is kept-or-dropped
//      together (INFO sampled to 10% in prod; WARN/ERROR always ship).
//   3. Function entry + outcome ONLY — no per-step logging. The HOF wraps the
//      handler; it never wraps individual step.run calls.
//
// INNGEST DETERMINISM: this HOF never mints a step ID and never interpolates
// Date.now()/randomUUID() into one (see feedback_inngest_step_determinism.md —
// a non-deterministic step ID = infinite replay loop). The Date.now() reads
// here feed the `durationMs` log FIELD only, never a step ID.
//
// Note on fn.start under replay: Inngest re-executes the handler body on each
// step boundary, so `fn.start` may emit more than once per logical run. That
// is acceptable and cheap: it is INFO (sampled) and the keep/drop decision is
// requestId/runId-stable, so the duplicates are consistently kept or dropped
// together. `fn.complete` fires once (only the final replay reaches the end);
// `fn.error` fires on the throwing replay. The load-bearing monitor signals
// (#515 error-rate + completion) are therefore exactly-once.

import type { GetFunctionInput } from "inngest";
import { getLogger } from "@askarthur/utils/axiom-logger";
import { isProductionDeployment, readBoolEnv } from "@askarthur/utils/env";

import { inngest } from "./client";

// Inngest's internal event name for a cron-scheduled invocation (vs. an
// event/manual trigger). Mirrors `internalEvents.ScheduledTimer` in the SDK.
//
// EXPORTED, and that matters. This fact lived here as a module-private const
// while #1107 shipped `event?.data ? parse(event.data) : fallback` in two
// other functions — a truthiness test that is WRONG precisely because a cron
// tick carries `data: { cron: string }`. The knowledge was in the repo; the
// seam was not, so two stages failed 4x per tick until a Telegram page found
// it. One home for one fact.
export const CRON_TICK_EVENT = "inngest/scheduled.timer";

/**
 * Flush the batched Axiom logs before the handler returns — awaited, bounded,
 * and never allowed to fail the function.
 *
 * WHY AWAITED. This used to be `void log.flush()` with the comment "the
 * function instance outlives the flush". Measured on 2026-09-08, it does not:
 * shopfront-clone-haiku-preclassify received 44 events and Axiom recorded 41
 * fn.complete rows — a ~7% loss on an always-ship WARN signal. next-axiom's
 * flush is a keepalive fetch, which on a serverless runtime is not a guarantee;
 * once the response is sent the instance can be frozen with the request still
 * in flight. For a function that runs once a day, 7% means it vanishes from a
 * 30-day view about twice a month: clone-watch-enrich-attribution had
 * completed every daily run in September and showed as silent in Axiom for
 * all but one of them.
 *
 * It is the same false assumption #1072 already removed for cost_telemetry
 * ("fire-and-forget lost 11 of 19 rows to cancellation on 2026-09-01").
 *
 * WHY BOUNDED. next-axiom's flush has no timeout of its own, and awaiting an
 * external POST unbounded inside every function's final replay would let a
 * slow Axiom stall the whole fleet. Two seconds is far above the normal
 * round-trip and far below any step budget.
 *
 * WHY SWALLOWED. Telemetry must never be the reason a function fails.
 */
const FLUSH_BUDGET_MS = 2_000;

async function flushBounded(log: {
  flush: () => Promise<void>;
}): Promise<void> {
  await Promise.race([
    log.flush().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FLUSH_BUDGET_MS)),
  ]);
}

/**
 * True when this invocation came from a cron schedule rather than an event.
 *
 * Prefer this to any test on `event.data`. The cron payload is a POPULATED
 * object (`{ cron: "25 2,8,14,20 * * *" }`), so truthiness cannot distinguish
 * the two paths — and a strict Zod parse of it throws on every scheduled run.
 * Where a function needs a domain payload with a cron fallback, discriminate
 * on SHAPE with `safeParse` (see resolveRedditIntel*Data in ./events.ts);
 * where it only needs to know which trigger fired, use this.
 */
/**
 * True wall-clock elapsed for a run, in milliseconds — or null if unknowable.
 *
 * WHY THIS IS NOT `Date.now() - handlerEntry`. Inngest re-executes the handler
 * body FROM THE TOP at every step boundary, so any timestamp taken on handler
 * entry is reset by each replay. The previous `durationMs` field did exactly
 * that and therefore reported only the final segment: measured over seven days
 * of production, almost every function came back at avg=1ms — including
 * reddit-intel-cluster, which we watched hold a slot for minutes on 2026-09-07.
 * A field named "duration" that reports 1ms for a seven-minute run is worse
 * than no field, because it reads as health.
 *
 * The event's own `ts` survives replay because it is set when the run is
 * triggered, not when the handler starts (`EventPayload.ts` —
 * "milliseconds since the unix epoch at which this event occurred"). Cron ticks
 * carry it too.
 *
 * This includes queue wait as well as execution. That is deliberate: the
 * account runs on a 5-slot pool measured at 5/5 in use, so time spent WAITING
 * for a slot is exactly as interesting as time spent holding one (ADR-0019).
 *
 * Returns null rather than 0 when `ts` is absent — `ts` is optional in the SDK
 * type, and a confident zero is the failure mode this whole change is about.
 *
 * EXPORTED for wall-clock guards. A loop that awaits `step.run` per item spans
 * step boundaries, so a `Date.now()` captured in the handler body is reset by
 * every replay and the guard can never fire — measured across four clone-watch
 * functions on 2026-09-07, each with a detailed comment describing protection
 * it was not providing. A guard whose loop sits INSIDE a single step does not
 * have this problem and may use a local timestamp (see PERSIST_BUDGET_MS in
 * reddit-intel-cluster).
 */
export function elapsedSinceTrigger(ctx: {
  event?: { ts?: number } | undefined;
}): number | null {
  const ts = ctx.event?.ts;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return null;
  const elapsed = Date.now() - ts;
  // A clock-skewed or future-dated ts would otherwise emit a negative duration.
  return elapsed >= 0 ? elapsed : null;
}

export function isCronTick(event: { name?: string } | undefined): boolean {
  return event?.name === CRON_TICK_EVENT;
}

// The full Inngest handler context for OUR client (step, event, runId,
// attempt, logger, …). Using Inngest's own type keeps the wrapped handlers
// fully type-checked — `({ step, event }) => …` still resolves correctly.
type InngestCtx = GetFunctionInput<typeof inngest>;

/**
 * Wrap an Inngest function handler with Axiom lifecycle logging.
 *
 * @param meta.fnId  Stable function id (match the createFunction `id`).
 * @param handler    The original Inngest handler.
 * @returns          A handler with identical signature + behaviour, plus
 *                   fire-and-forget Axiom lifecycle logs.
 */
export function withAxiomLogging<TResult>(
  meta: { fnId: string },
  handler: (ctx: InngestCtx) => Promise<TResult>,
): (ctx: InngestCtx) => Promise<TResult> {
  return async (ctx: InngestCtx): Promise<TResult> => {
    // Production-only cron guard. Inngest provisions a separate branch
    // environment per Vercel preview deployment, and every preview shares the
    // production secrets (admin Telegram chat id, Supabase service key). An
    // unguarded cron therefore fires from EVERY open preview into the prod
    // admin chat and against the prod DB — the cause of the duplicate
    // "Known-brands discovery" / "Reddit brands discover" Telegram bursts
    // (prod fired each cron exactly once; the extra copies were branch envs).
    // We skip only scheduled.timer ticks, so event/manual triggers still run
    // in preview for testing. INNGEST_ALLOW_NONPROD_CRONS=true forces a cron
    // to run off-prod when you genuinely need to exercise a cron-only fn.
    if (
      ctx.event?.name === CRON_TICK_EVENT &&
      !isProductionDeployment() &&
      !readBoolEnv("INNGEST_ALLOW_NONPROD_CRONS")
    ) {
      return {
        skipped: true,
        reason: "non_production_cron",
      } as unknown as TResult;
    }

    const rawRequestId = (
      ctx.event?.data as Record<string, unknown> | undefined
    )?.requestId;
    const requestId =
      typeof rawRequestId === "string" && rawRequestId.length > 0
        ? rawRequestId
        : ctx.runId;

    const log = getLogger({ source: "inngest", requestId, fn: meta.fnId });
    const segmentStartedAt = Date.now();
    log.info("fn.start", { fn: meta.fnId, attempt: ctx.attempt });

    try {
      const result = await handler(ctx);
      // WARN, not INFO — and this is the one signal that must not be sampled.
      //
      // `fn.complete` fires exactly ONCE per logical run (see the replay note
      // above), which makes it the only true run counter this wrapper emits.
      // At INFO it was sampled to 10%, so for any low-frequency function you
      // could not tell "ran fine" from "never ran": archive-shadows-retention
      // showed 1 start and 0 completes across ~19 nightly runs, and answering
      // "is it healthy?" meant querying whether rows had actually moved.
      // warn/error bypass sampling entirely (axiom-logger.ts), so this now
      // ships every time.
      //
      // `fn.start` deliberately stays INFO: Inngest re-executes the handler at
      // every step boundary, so it fires MORE than once per run. Un-sampling
      // it would add volume without producing a run counter.
      log.warn("fn.complete", {
        fn: meta.fnId,
        // attempt is on the completion too, not just fn.start. event.ts is the
        // ORIGINAL trigger time, so on a retry elapsedSinceTriggerMs includes
        // every prior attempt and its backoff — which is not slot time. Without
        // this field there is no way to exclude those rows, and the metric this
        // change adds would be uninterpretable in exactly the cases that matter.
        attempt: ctx.attempt,
        elapsedSinceTriggerMs: elapsedSinceTrigger(ctx),
        finalSegmentMs: Date.now() - segmentStartedAt,
      });
      await flushBounded(log);
      return result;
    } catch (err) {
      log.error("fn.error", {
        fn: meta.fnId,
        attempt: ctx.attempt,
        elapsedSinceTriggerMs: elapsedSinceTrigger(ctx),
        finalSegmentMs: Date.now() - segmentStartedAt,
        error: err instanceof Error ? err.message : String(err),
        error_name: err instanceof Error ? err.name : "Unknown",
      });
      await flushBounded(log);
      throw err;
    }
  };
}
