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
}

interface WorklistAlert {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string | null;
  target_brand_normalized: string | null;
}

export async function getNetcraftResults(): Promise<NetcraftResults> {
  const sb = createServiceClient();
  if (!sb) return { pending: [], filed: [], configured: false };

  // v216 RPC is uuid-atomic: one row per submission with its alerts aggregated.
  const { data: worklist } = await sb.rpc(
    "list_clone_alerts_pending_netcraft_issue",
    { p_max_age_days: 30, p_uuid_limit: 100 },
  );

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
  const { data: filedRows } = await sb
    .from("shopfront_clone_alerts")
    .select(
      "id, candidate_url, candidate_domain, target_brand_normalized, inferred_target_domain, submitted_to",
    )
    .not("submitted_to->netcraft_issue->>issue_reported_at", "is", null)
    .order("submitted_to->netcraft_issue->>issue_reported_at", {
      ascending: false,
    })
    .limit(100);

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

  return { pending, filed, configured: true };
}
