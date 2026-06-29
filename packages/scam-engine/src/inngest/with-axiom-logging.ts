// withAxiomLogging — Inngest function observability HOF (#514).
//
// Wraps an Inngest handler to emit exactly the lifecycle signals the #515
// dashboards/monitors need: `fn.start` (INFO), `fn.complete` (INFO,
// durationMs) and `fn.error` (ERROR, always ships). It threads the same
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
const CRON_TICK_EVENT = "inngest/scheduled.timer";

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

    const rawRequestId = (ctx.event?.data as Record<string, unknown> | undefined)
      ?.requestId;
    const requestId =
      typeof rawRequestId === "string" && rawRequestId.length > 0
        ? rawRequestId
        : ctx.runId;

    const log = getLogger({ source: "inngest", requestId, fn: meta.fnId });
    const startedAt = Date.now();
    log.info("fn.start", { fn: meta.fnId, attempt: ctx.attempt });

    try {
      const result = await handler(ctx);
      log.info("fn.complete", {
        fn: meta.fnId,
        durationMs: Date.now() - startedAt,
      });
      // Fire-and-forget per #514: no-op when the flag is off; when on,
      // next-axiom batches and the function instance outlives the flush.
      void log.flush();
      return result;
    } catch (err) {
      log.error("fn.error", {
        fn: meta.fnId,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
        error_name: err instanceof Error ? err.name : "Unknown",
      });
      void log.flush();
      throw err;
    }
  };
}
