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

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function getQueueCounts(svc: Svc): Promise<QueueCounts> {
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

export async function getRecentFeedRuns(svc: Svc): Promise<FeedRun[]> {
  if (!svc) return [];
  const { data } = await svc
    .from("feed_ingestion_log")
    .select("feed_name, status, started_at")
    .order("started_at", { ascending: false })
    .limit(50);
  const seen = new Set<string>();
  const recent: FeedRun[] = [];
  for (const r of (data ?? []) as FeedRun[]) {
    if (seen.has(r.feed_name)) continue;
    seen.add(r.feed_name);
    recent.push(r);
  }
  return recent;
}

export async function getArchiveStats(svc: Svc): Promise<ArchiveStats> {
  if (!svc) return { hot: 0, archived: 0 };
  const [hot, archived] = await Promise.all([
    svc.from("scam_reports").select("id", { count: "exact", head: true }),
    svc
      .from("scam_reports_archive")
      .select("id", { count: "exact", head: true }),
  ]);
  return { hot: hot.count ?? 0, archived: archived.count ?? 0 };
}

export async function getStripeEventStats(svc: Svc): Promise<StripeEventStats> {
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
      .is("processed_at", null),
    svc
      .from("stripe_event_log")
      .select("event_type, received_at, processed_at")
      .order("received_at", { ascending: false })
      .limit(10),
  ]);
  return {
    total: totalRes.count ?? 0,
    unprocessed: unprocessedRes.count ?? 0,
    recent: (recentRes.data ?? []) as StripeEventRow[],
  };
}
