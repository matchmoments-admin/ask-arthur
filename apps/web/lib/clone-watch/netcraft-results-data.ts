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

interface WorklistRow {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string | null;
  target_brand_normalized: string | null;
  netcraft_uuid: string;
}

export async function getNetcraftResults(): Promise<NetcraftResults> {
  const sb = createServiceClient();
  if (!sb) return { pending: [], filed: [], configured: false };

  const { data: worklist } = await sb.rpc(
    "list_clone_alerts_pending_netcraft_issue",
    { p_max_age_days: 14, p_limit: 500 },
  );

  // Group the worklist by submission uuid for display.
  const groups = new Map<string, WorklistRow[]>();
  for (const r of (worklist as WorklistRow[] | null) ?? []) {
    const list = groups.get(r.netcraft_uuid) ?? [];
    list.push(r);
    groups.set(r.netcraft_uuid, list);
  }
  const pending: PendingIssueRow[] = [...groups.entries()].map(([uuid, rows]) => ({
    netcraft_uuid: uuid,
    alertCount: rows.length,
    brands: [
      ...new Set(
        rows.map((r) => r.target_brand_normalized || r.inferred_target_domain || "?"),
      ),
    ],
    sampleUrl: rows[0]?.candidate_url ?? "",
  }));

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
