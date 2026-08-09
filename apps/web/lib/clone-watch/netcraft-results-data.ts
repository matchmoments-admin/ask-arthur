import { createServiceClient } from "@askarthur/supabase/server";

/**
 * Read model for the /admin/netcraft-results panel (read-only). Surfaces the
 * false-negative worklist (what the reporter WOULD file) + recently-filed
 * issues, so the founder can watch the automation during the dry-run window.
 */

export interface PendingIssueRow {
  netcraft_uuid: string;
  alertCount: number;
  brands: string[];
  sampleUrl: string;
}

export interface FiledIssueRow {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  brand: string | null;
  issue_reported_at: string | null;
  issue_url_state: string | null;
}

export interface NetcraftResults {
  pending: PendingIssueRow[];
  filed: FiledIssueRow[];
  configured: boolean;
  /**
   * EXACT count of filed issues, independent of the capped `filed` list.
   * Null when the count query itself failed — the caller must then say the
   * number is a floor rather than print the capped length as if it were total.
   */
  filedTotal: number | null;
  /** Human-readable names of the reads that failed; empty when all succeeded. */
  loadErrors: string[];
}

interface WorklistAlert {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string | null;
  target_brand_normalized: string | null;
}

export async function getNetcraftResults(): Promise<NetcraftResults> {
  const loadErrors: string[] = [];
  const sb = createServiceClient();
  if (!sb) {
    return { pending: [], filed: [], configured: false, filedTotal: null, loadErrors };
  }

  // v216 RPC is uuid-atomic: one row per submission with its alerts aggregated.
  //
  // `pending` stays a CAPPED list length on purpose. Its gate is the 9-clause
  // jsonb predicate in migration-v221 (evidence gate + drain-aware
  // issue_reported_at triple + attempts < 3 + recheck_after cool-down) and the
  // value wanted is COUNT(DISTINCT uuid); re-expressing that through PostgREST
  // would fork the evidence gate and drift from it silently. An exact figure
  // needs a count_* RPC — tracked on #945, not faked here.
  const { data: worklist, error: worklistErr } = await sb.rpc(
    "list_clone_alerts_pending_netcraft_issue",
    { p_max_age_days: 30, p_uuid_limit: 100 },
  );
  if (worklistErr) loadErrors.push("pending submissions");

  const pending: PendingIssueRow[] = (
    (worklist as Array<{ netcraft_uuid: string; alerts: unknown }> | null) ?? []
  ).map((r) => {
    const alerts = Array.isArray(r.alerts) ? (r.alerts as WorklistAlert[]) : [];
    return {
      netcraft_uuid: r.netcraft_uuid,
      alertCount: alerts.length,
      brands: [
        ...new Set(
          alerts.map(
            (a) => a.target_brand_normalized || a.inferred_target_domain || "?",
          ),
        ),
      ],
      sampleUrl: alerts[0]?.candidate_url ?? "",
    };
  });

  // Recently-filed issues (netcraft_issue.issue_reported_at present).
  // The list is capped at 100 for the table; the pill reads filedTotal below,
  // so "N filed" does not silently freeze at 100 once we pass it.
  const { data: filedRows, error: filedErr } = await sb
    .from("shopfront_clone_alerts")
    .select(
      "id, candidate_url, candidate_domain, target_brand_normalized, inferred_target_domain, submitted_to",
    )
    .not("submitted_to->netcraft_issue->>issue_reported_at", "is", null)
    .order("submitted_to->netcraft_issue->>issue_reported_at", {
      ascending: false,
    })
    .limit(100);
  if (filedErr) loadErrors.push("filed issues");

  const { count: filedCount, error: filedCountErr } = await sb
    .from("shopfront_clone_alerts")
    .select("id", { count: "exact", head: true })
    .not("submitted_to->netcraft_issue->>issue_reported_at", "is", null);
  // A head-count against a missing table/column returns count:null with a null
  // error (measured 2026-08-09), so the null check is the load-bearing one —
  // without it the pill printed a confident "0 filed" over 41 real rows.
  const filedCountFailed = Boolean(filedCountErr) || filedCount === null;
  if (filedCountFailed) loadErrors.push("filed-issue count");

  const filed: FiledIssueRow[] = ((filedRows as Array<Record<string, unknown>> | null) ?? []).map(
    (r) => {
      const issue =
        ((r.submitted_to as Record<string, unknown> | null)?.netcraft_issue as
          | Record<string, unknown>
          | undefined) ?? {};
      return {
        id: r.id as number,
        candidate_url: r.candidate_url as string,
        candidate_domain: r.candidate_domain as string,
        brand:
          (r.target_brand_normalized as string | null) ??
          (r.inferred_target_domain as string | null),
        issue_reported_at: (issue.issue_reported_at as string | null) ?? null,
        issue_url_state: (issue.issue_url_state as string | null) ?? null,
      };
    },
  );

  return {
    pending,
    filed,
    configured: true,
    filedTotal: filedCountFailed ? null : filedCount,
    loadErrors,
  };
}
