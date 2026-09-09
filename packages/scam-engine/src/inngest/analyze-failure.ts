import { inngest } from "./client";
import { withAxiomLogging } from "./with-axiom-logging";
import { logger } from "@askarthur/utils/logger";

// Subscribes to the Inngest system event fired when ANY function's final
// retry fails. Filters to analyze-pipeline functions only (by id prefix)
// so we don't page on unrelated scheduler failures.
//
// Phase 2 scope: structured logging only. Sentry integration is deferred
// per user direction — when Sentry is adopted (Phase 4b), swap the
// logger.error call for a Sentry.captureException + Telegram fan-out.

const ANALYZE_FUNCTION_ID_PREFIX = "analyze-";

// `inngest/function.failed` carries the ABSOLUTE function id — the app id and
// the function id joined by a hyphen. InngestFunction.id(prefix) is
// `[prefix, opts.id].filter(Boolean).join("-")` and the SDK's own onFailure
// trigger compares `event.data.function_id == '<prefixed id>'`, so with
// `new Inngest({ id: "askarthur" })` the value is
// "askarthur-analyze-report", not "analyze-report".
//
// THAT MEANS THE FAMILY FILTER NEVER MATCHED. `fnId.startsWith("analyze-")`
// was false for every real event, so this subscriber has logged NOTHING since
// it was written — it returned `{ filtered: true }` for the entire fleet
// including the analyze functions it exists for. The self-exclusion added in
// #1135 was inert for the same reason. Strip the prefix before either test.
const APP_ID_PREFIX = "askarthur-";

/**
 * The function id with the app prefix removed, if present.
 *
 * EXPORTED so the filter it feeds can be tested by calling it. The bug it
 * fixes was invisible from inside this file: both the family filter and the
 * self-exclusion read correct, and both compared against a string shape the
 * platform never sends.
 */
export function bareFunctionId(fnId: string): string {
  return fnId.startsWith(APP_ID_PREFIX)
    ? fnId.slice(APP_ID_PREFIX.length)
    : fnId;
}

// This function's OWN id, excluded below. "analyze-failure-subscriber" starts
// with the prefix it filters on, so its own final-retry failure matched its
// own filter and was logged as an analyze-pipeline failure — a subscriber
// reporting on itself, one level deep. It cannot loop (the handler only reads
// fields and logs, so it does not throw), but the line it produced was noise
// attributed to the wrong family.
const SELF_FUNCTION_ID = "analyze-failure-subscriber";

export const onAnalyzeFailed = inngest.createFunction(
  {
    id: SELF_FUNCTION_ID,
    name: "Analyze: subscribe to function failures",
    // CONTAINMENT (#1135). This is the fleet's only unbounded fan-in: it
    // triggers on EVERY function's final-retry failure, fleet-wide, and until
    // now declared no concurrency, throttle, rateLimit or idempotency at all.
    // In steady state that is ~zero invocations; during an incident — the
    // slot-crunch cancellations, a Supabase outage, a bad deploy — it scales
    // 1:1 with failures across ~46 functions, each one an invocation and an
    // Axiom line, at exactly the moment the account can least afford them.
    //
    // rateLimit, not throttle: throttle QUEUES the excess, which during a
    // failure storm is precisely the wrong thing — it would hold the backlog
    // (and the slots) long after the storm. rateLimit DISCARDS it
    // (memory/MEMORY.md). The scheduled-tick trap that makes rateLimit wrong
    // on a cron function does not apply: this has no cron trigger.
    //
    // Keyed by function_id so the cap is PER FAILING FUNCTION. One function
    // failing in a loop is capped at 5/h; a second, unrelated function failing
    // still gets through. A global cap would have let the loud failure mask
    // the interesting one.
    //
    // What is lost when the cap bites: duplicate log lines about one root
    // cause. The primary signal is not this function — withAxiomLogging emits
    // fn.error at ERROR level (never sampled) from the failing function
    // itself. This subscriber is a secondary, console-only convenience.
    rateLimit: { limit: 5, period: "1h", key: "event.data.function_id" },
    // ADR-0019's circuit breaker.
    //
    // inngest-finish-budget: 0 boundaries — the handler has no step.run at
    // all; it reads fields off the event and writes one log line. The floor is
    // therefore 0 x 30s + 60s slack = 60s. Declared 2m, the smallest honest
    // finite value: with zero steps there is nothing for a queue wait to
    // apply to, and anything larger would be a breaker that never trips.
    timeouts: { finish: "2m" },
  },
  { event: "inngest/function.failed" },
  withAxiomLogging(
    { fnId: "analyze-failure-subscriber" },
    async ({ event }) => {
      // The system event's data shape is:
      // {
      //   function_id: string,
      //   run_id: string,
      //   error: { name, message, stack },
      //   event: <original event that triggered the failed fn>,
      // }
      const data = event.data as {
        function_id?: string;
        run_id?: string;
        error?: { name?: string; message?: string; stack?: string };
        event?: { name?: string; data?: Record<string, unknown> };
      };

      const fnId = data.function_id ?? "unknown";
      const bareId = bareFunctionId(fnId);
      if (bareId === SELF_FUNCTION_ID) {
        return { filtered: true, fnId, reason: "self" };
      }
      if (!bareId.startsWith(ANALYZE_FUNCTION_ID_PREFIX)) {
        // Out of scope — another subscriber can handle other function
        // families. Returning early is cheaper than filtering server-side
        // (Inngest doesn't have a prefix match in `event` filters).
        return { filtered: true, fnId };
      }

      logger.error("analyze.function.failed", {
        functionId: fnId,
        runId: data.run_id,
        errorName: data.error?.name,
        errorMessage: data.error?.message,
        // Log the triggering event's requestId so we can correlate the
        // failure back to the original request without dumping PII.
        triggeringRequestId: (
          data.event?.data as { requestId?: string } | undefined
        )?.requestId,
        triggeringEvent: data.event?.name,
      });

      // Phase 4b TODO: Sentry.captureException + Telegram admin ping here.

      return { logged: true, fnId };
    },
  ),
);
