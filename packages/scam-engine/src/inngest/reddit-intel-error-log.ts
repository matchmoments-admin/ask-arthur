// Shared diagnostic error sink for the Reddit Intel pipeline.
//
// All three Inngest functions (daily classifier, embed, cluster) wrap their
// risky steps with logFunctionError → re-throw. The catch writes a row to
// cost_telemetry tagged feature='reddit-intel-error' so failures are
// SQL-queryable from anywhere with Supabase access:
//
//   SELECT created_at, operation, metadata
//   FROM cost_telemetry
//   WHERE feature = 'reddit-intel-error'
//   ORDER BY created_at DESC LIMIT 10;
//
// Rationale: when a function fails inside Inngest, the dashboard surfaces
// the error but only via UI / API. Writing to cost_telemetry gives us a
// vendor-independent record that survives Inngest plan limits, doesn't
// require an Inngest API token, and groups naturally next to cost data.

import { createServiceClient } from "@askarthur/supabase/server";

export interface FunctionErrorContext {
  /** The Inngest step name where the failure occurred. */
  step: string;
  /** ISO date for the cohort being processed; "unknown" if not yet computed. */
  cohortDate: string;
  /** Optional batch / cohort size at time of failure for context. */
  postCount?: number;
  /** The thrown value — Error, string, or anything. */
  error: unknown;
  /** Optional version tag for the prompt or function logic. */
  promptVersion?: string;
  /** Optional extra metadata (provider, model, etc.). */
  extra?: Record<string, unknown>;
}

/**
 * Insert a diagnostic error row. Best-effort: on Supabase failure, the
 * insert is silently dropped (we don't want the diagnostic itself to throw
 * and mask the original error).
 */
export async function logFunctionError(
  ctx: FunctionErrorContext,
): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;

  const err = ctx.error;
  try {
    await supabase.from("cost_telemetry").insert({
      feature: "reddit-intel-error",
      provider: "diagnostic",
      operation: ctx.step,
      units: 0,
      estimated_cost_usd: 0,
      metadata: {
        error_message: err instanceof Error ? err.message : String(err),
        error_name: err instanceof Error ? err.name : "Unknown",
        error_stack:
          err instanceof Error ? (err.stack ?? "").slice(0, 2000) : "",
        cohort_date: ctx.cohortDate,
        post_count: ctx.postCount ?? null,
        prompt_version: ctx.promptVersion ?? null,
        ...(ctx.extra ?? {}),
      },
    });
  } catch {
    // Diagnostic insert failed — swallow. Caller will re-throw the
    // original error and Inngest will record the failure on its side.
  }
}
