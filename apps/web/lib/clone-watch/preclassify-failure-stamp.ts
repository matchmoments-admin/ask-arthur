// Pre-classifier FAILURE STAMP (#1300, v345).
//
// An alert the classifier throws on (vendor error, answer-shape error, persist
// error) used to leave no mark: the daily selector re-fanned it every day for
// 14 days. With v345's oldest-first order a poison alert would sit at the HEAD
// of the worklist (worklist-gate-starvation rule). The stamp counts failed UTC
// days per alert in clone_watch_preclassify_failures; the selector gives up at
// 3 and the NRD ingest's Outcome Row reports `preclassify_gave_up_24h`.
//
// Never throws — the pre-classifier batch is a hot path and a failed stamp
// must not fail (and re-run) a batch of paid classifications. A failed stamp
// is reported (`failure_stamp_failed` on the Outcome Row, which pages).

import type { createServiceClient } from "@askarthur/supabase/server";

type Sb = NonNullable<ReturnType<typeof createServiceClient>>;

export interface FailureStampResult {
  /** Rows written (an unknown alert id is skipped by the RPC). */
  stamped: number;
  /** Set when the RPC failed; nothing is thrown. */
  error: string | null;
}

export async function stampPreclassifyFailures(
  sb: Sb,
  failures: ReadonlyArray<{ alertId: number; error: string }>,
): Promise<FailureStampResult> {
  if (failures.length === 0) return { stamped: 0, error: null };
  try {
    const { data, error } = await sb.rpc(
      "record_clone_watch_preclassify_failures",
      {
        p_failures: failures.map((f) => ({
          alert_id: f.alertId,
          error: f.error,
        })),
      },
    );
    if (error) return { stamped: 0, error: error.message };
    return {
      stamped: typeof data === "number" ? data : Number(data ?? 0),
      error: null,
    };
  } catch (err) {
    return {
      stamped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
