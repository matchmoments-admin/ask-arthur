// Regression coverage for the admin/health loaders extracted from
// apps/web/app/admin/health/page.tsx. Each loader has two paths:
// happy (svc available, returns rows) and null-client fallback
// (createServiceClient returned null because env vars missing).
//
// The null path is the operationally important one — without it,
// the /admin/health page would 500 on any environment that hasn't
// finished bootstrapping Supabase env vars.

import { describe, it, expect, vi } from "vitest";

import {
  getQueueCounts,
  getOldestPendingMinutes,
  getRecentFeedRuns,
  getArchiveStats,
  getStripeEventStats,
} from "../admin-health";

// Lightweight builder for a chainable supabase query stub that
// terminates with `Promise.resolve({ data, count })`. Sufficient for
// the count-only and limit-N shapes used by these loaders.
function makeQuery(result: { data?: unknown; count?: number | null }) {
  // Each method must return a thenable that ALSO supports further
  // chaining (.eq / .order / .limit / .is / .gte) — Supabase's builder
  // pattern resolves on await or after a terminal helper.
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    is: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return chain;
}

function makeSvc(table: string, result: { data?: unknown; count?: number | null }) {
  return {
    from: vi.fn((t: string) => {
      if (t !== table) throw new Error(`unexpected table: ${t}`);
      return makeQuery(result);
    }),
  } as unknown as Parameters<typeof getQueueCounts>[0];
}

describe("admin-health loaders — null-client fallback", () => {
  it("getQueueCounts returns zeros when svc is null", async () => {
    expect(await getQueueCounts(null)).toEqual({
      pending: 0,
      processing: 0,
      failed: 0,
      completed: 0,
    });
  });

  it("getOldestPendingMinutes returns null when svc is null", async () => {
    expect(await getOldestPendingMinutes(null)).toBeNull();
  });

  it("getRecentFeedRuns returns [] when svc is null", async () => {
    expect(await getRecentFeedRuns(null)).toEqual([]);
  });

  it("getArchiveStats returns {hot:0, archived:0} when svc is null", async () => {
    expect(await getArchiveStats(null)).toEqual({ hot: 0, archived: 0 });
  });

  it("getStripeEventStats returns empty shape when svc is null", async () => {
    expect(await getStripeEventStats(null)).toEqual({
      total: 0,
      unprocessed: 0,
      recent: [],
    });
  });
});

describe("admin-health loaders — happy path", () => {
  it("getOldestPendingMinutes computes minutes from created_at", async () => {
    const minutesAgo = 17;
    const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const svc = makeSvc("bot_message_queue", {
      data: [{ created_at: createdAt }],
    });
    const result = await getOldestPendingMinutes(svc);
    // Allow ±1 minute for runtime jitter between Date.now() calls.
    expect(result).toBeGreaterThanOrEqual(minutesAgo - 1);
    expect(result).toBeLessThanOrEqual(minutesAgo + 1);
  });

  it("getOldestPendingMinutes returns null when no pending rows", async () => {
    const svc = makeSvc("bot_message_queue", { data: [] });
    expect(await getOldestPendingMinutes(svc)).toBeNull();
  });

  it("getRecentFeedRuns dedupes by feed_name, preserving first occurrence", async () => {
    const data = [
      { feed_name: "scamwatch_alerts", status: "success", started_at: "2026-05-18T10:00:00Z" },
      { feed_name: "scamwatch_alerts", status: "error", started_at: "2026-05-18T09:00:00Z" },
      { feed_name: "urlhaus", status: "success", started_at: "2026-05-18T08:00:00Z" },
    ];
    const svc = makeSvc("feed_ingestion_log", { data });
    const result = await getRecentFeedRuns(svc);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ feed_name: "scamwatch_alerts", status: "success" });
    expect(result[1]).toMatchObject({ feed_name: "urlhaus" });
  });
});
