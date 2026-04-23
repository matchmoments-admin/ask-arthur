import { inngest } from "./client";
import { logger } from "@askarthur/utils/logger";

// Subscribes to the Inngest system event fired when ANY function's final
// retry fails. Filters to analyze-pipeline functions only (by id prefix)
// so we don't page on unrelated scheduler failures.
//
// Phase 2 scope: structured logging only. Sentry integration is deferred
// per user direction — when Sentry is adopted (Phase 4b), swap the
// logger.error call for a Sentry.captureException + Telegram fan-out.

const ANALYZE_FUNCTION_ID_PREFIX = "analyze-";

export const onAnalyzeFailed = inngest.createFunction(
  {
    id: "analyze-failure-subscriber",
    name: "Analyze: subscribe to function failures",
  },
  { event: "inngest/function.failed" },
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
    if (!fnId.startsWith(ANALYZE_FUNCTION_ID_PREFIX)) {
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
      triggeringRequestId:
        (data.event?.data as { requestId?: string } | undefined)?.requestId,
      triggeringEvent: data.event?.name,
    });

    // Phase 4b TODO: Sentry.captureException + Telegram admin ping here.

    return { logged: true, fnId };
  }
);
