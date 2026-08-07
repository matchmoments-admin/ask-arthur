// Admin /health dashboard data loaders.
//
// Extracted from apps/web/app/admin/health/page.tsx so the queries can be
// tested in isolation and reused if other admin surfaces need the same
// signals. Pure code motion — no behaviour change.

import "server-only";

import type { createServiceClient } from "@askarthur/supabase/server";

type Svc = ReturnType<typeof createServiceClient>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueueCounts {
  pending: number;
  processing: number;
  failed: number;
  completed: number;
}

export interface FeedRun {
  feed_name: string;
  status: string;
  started_at: string | null;
}

export interface StripeEventRow {
  event_type: string;
  received_at: string;
  processed_at: string | null;
}

export interface StripeEventStats {
  total: number;
  unprocessed: number;
  recent: StripeEventRow[];
}

export interface ArchiveStats {
  hot: number;
  archived: number;
}

/**
 * Optional error collector (#941 finding 9 / #945): every loader in this
 * module previously coalesced query errors into zeros/[] — a failed query
 * rendered identically to a healthy-empty one (the #929 class, error path).
 * Callers pass an array; loaders push a short label per failed query and
 * the page renders an explicit error band when it's non-empty.
 */
export type LoadErrors = string[];

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function getQueueCounts(
  svc: Svc,
  errors?: LoadErrors,
): Promise<QueueCounts> {
  const empty: QueueCounts = {
    pending: 0,
    processing: 0,
    failed: 0,
    completed: 0,
  };
  if (!svc) return empty;

  const statuses: Array<keyof QueueCounts> = [
    "pending",
    "processing",
    "failed",
    "completed",
  ];
  const results = await Promise.all(
    statuses.map((status) =>
      svc
        .from("bot_message_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", status),
    ),
  );
  const out: QueueCounts = { ...empty };
  statuses.forEach((s, i) => {
    if (results[i].error) errors?.push(`bot queue (${s})`);
    out[s] = results[i].count ?? 0;
  });
  return out;
}

export async function getOldestPendingMinutes(
  svc: Svc,
): Promise<number | null> {
  if (!svc) return null;
  const { data } = await svc
    .from("bot_message_queue")
    .select("created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  const row = data?.[0];
  if (!row?.created_at) return null;
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return Math.round(ageMs / 60000);
}

export async function getRecentFeedRuns(
  svc: Svc,
  errors?: LoadErrors,
): Promise<FeedRun[]> {
  if (!svc) return [];
  // Reads the feed_health VIEW (migration-v264), not raw feed_ingestion_log.
  // The previous implementation had the exact defect class v264 was built to
  // kill — newest-N rows grouped by what's present, so a feed that stopped
  // writing vanished from the panel — and on top of that selected a
  // `started_at` column that does not exist in prod, so the query errored
  // and this panel silently rendered EMPTY (found 2026-08-07, Tier 3 review;
  // one row per enabled feed with real per-feed aggregates is the fix).
  const { data, error } = await svc
    .from("feed_health")
    .select("feed_name, is_muted, last_run_at, hours_since_success")
    .order("feed_name");
  if (error) errors?.push("feed health");
  return ((data ?? []) as Array<{
    feed_name: string;
    is_muted: boolean;
    last_run_at: string | null;
    hours_since_success: number | null;
  }>).map((r) => ({
    feed_name: r.feed_name,
    started_at: r.last_run_at,
    status: r.is_muted
      ? "muted"
      : r.hours_since_success !== null && r.hours_since_success <= 36
        ? "ok"
        : "stale",
  }));
}

export async function getArchiveStats(
  svc: Svc,
  errors?: LoadErrors,
): Promise<ArchiveStats> {
  if (!svc) return { hot: 0, archived: 0 };
  const [hot, archived] = await Promise.all([
    svc.from("scam_reports").select("id", { count: "exact", head: true }),
    svc
      .from("scam_reports_archive")
      .select("id", { count: "exact", head: true }),
  ]);
  if (hot.error) errors?.push("archive (hot count)");
  if (archived.error) errors?.push("archive (archived count)");
  return { hot: hot.count ?? 0, archived: archived.count ?? 0 };
}

export async function getStripeEventStats(
  svc: Svc,
  errors?: LoadErrors,
): Promise<StripeEventStats> {
  if (!svc) return { total: 0, unprocessed: 0, recent: [] };
  const since = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const [totalRes, unprocessedRes, recentRes] = await Promise.all([
    svc
      .from("stripe_event_log")
      .select("event_id", { count: "exact", head: true })
      .gte("received_at", since),
    svc
      .from("stripe_event_log")
      .select("event_id", { count: "exact", head: true })
      .is("processed_at", null)
      // Same 7d window as "received" — mixing a windowed and an all-time
      // count under one "(7d)" heading is the #941 finding-10 class.
      .gte("received_at", since),
    svc
      .from("stripe_event_log")
      .select("event_type, received_at, processed_at")
      .order("received_at", { ascending: false })
      .limit(10),
  ]);
  if (totalRes.error || unprocessedRes.error || recentRes.error) {
    errors?.push("stripe events");
  }
  return {
    total: totalRes.count ?? 0,
    unprocessed: unprocessedRes.count ?? 0,
    recent: (recentRes.data ?? []) as StripeEventRow[],
  };
}
