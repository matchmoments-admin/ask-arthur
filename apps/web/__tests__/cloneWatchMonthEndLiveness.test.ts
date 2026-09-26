import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * clone-watch-month-end-liveness (v325, #1225) — the handler, with a fake
 * Supabase and a stubbed resolver.
 *
 * Go-red record:
 *   - "carries a short chunk's tail": advance `offset` by CHUNK_SIZE instead of
 *     `chunk.handled` → ids 31.. are never snapshotted nor marked.
 *   - "marks what the chunk cap never reached": delete the mark-unprobed step
 *     → the snapshot covers 30 of 250 and not_probed is 0.
 *   - "resets dead-dormant rows that resolve": drop the RPC call →
 *     dormancy_reset 0.
 *   - "completion record": move the record-run step above the probe loop →
 *     the record precedes the snapshot rows (and a mid-walk death would
 *     leave a complete-looking record over a partial snapshot).
 *   - "starts clean": drop the snapshot delete in load-stock → rows of an
 *     alert that left the stock survive a rerun.
 */

const m = vi.hoisted(() => ({
  outcome: vi.fn(),
  probe: vi.fn(),
  rpc: vi.fn(),
  upserts: [] as Array<Record<string, unknown>>,
  runs: [] as Array<Record<string, unknown>>,
  // Ordered log of writes: "delete:<table>", "snap", "run".
  writes: [] as string[],
  alerts: [] as Array<Record<string, unknown>>,
  chunkOverride: null as null | ((input: unknown) => unknown),
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (config: unknown, triggers: unknown, handler: unknown) => ({ config, triggers, handler }),
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
vi.mock("@askarthur/scam-engine/lane-outcome", () => ({ recordLaneOutcome: m.outcome }));
vi.mock("@/lib/clone-watch/liveness", async (orig) => ({
  ...(await orig<typeof import("@/lib/clone-watch/liveness")>()),
  probeStockDns: m.probe,
}));
vi.mock("@/lib/clone-watch/month-end-stock", async (orig) => {
  const real = await orig<typeof import("@/lib/clone-watch/month-end-stock")>();
  return {
    ...real,
    probeChunk: (input: Parameters<typeof real.probeChunk>[0]) =>
      m.chunkOverride ? m.chunkOverride(input) : real.probeChunk(input),
  };
});

// A fake PostgREST: just enough chain for the three reads, the upsert and the RPC.
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const state: { ids?: number[] } = {};
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        not: () => chain,
        lt: () => chain,
        order: () => chain,
        range: async (from: number, to: number) => ({
          data: m.alerts.slice(from, to + 1),
          error: null,
        }),
        in: async (_c: string, ids: number[]) => {
          state.ids = ids;
          return { data: m.alerts.filter((a) => ids.includes(a.id as number)), error: null };
        },
        upsert: async (rows: Array<Record<string, unknown>> | Record<string, unknown>) => {
          if (table === "clone_liveness_snapshots") {
            m.upserts.push(...(rows as Array<Record<string, unknown>>));
            m.writes.push("snap");
          }
          if (table === "clone_liveness_runs") {
            m.runs.push(rows as Record<string, unknown>);
            m.writes.push("run");
          }
          return { error: null };
        },
        delete: () => ({
          eq: async () => {
            m.writes.push(`delete:${table}`);
            return { error: null };
          },
        }),
      };
      return chain;
    },
    rpc: m.rpc,
  }),
}));

import { cloneWatchMonthEndLiveness } from "@/app/api/inngest/functions/clone-watch-month-end-liveness";

type Fn = { handler: (ctx: unknown) => Promise<Record<string, unknown>>; triggers: unknown[] };
const fn = cloneWatchMonthEndLiveness as unknown as Fn;
const run = (periodMonth = "2026-09") =>
  fn.handler({
    event: { name: "clone-watch/month-end-liveness.manual-trigger.v1", data: { periodMonth } },
    step: { run: (_n: string, f: () => unknown) => f() },
  });

const alert = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  candidate_domain: `d${id}.com`,
  inferred_target_domain: "kmart.com.au",
  lifecycle_state: "declined",
  triage_status: null,
  attribution: null,
  urlscan_classification: null,
  urlscan_uuid: "u",
  urlscan_failure_streak: 0,
  urlscan_evidence: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // The month just closed is September.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
  m.upserts.length = 0;
  m.runs.length = 0;
  m.writes.length = 0;
  m.chunkOverride = null;
  m.probe.mockResolvedValue({ a: { records: ["1.2.3.4"] }, aaaa: null, ns: { records: ["ns1.cloudflare.com"] } });
  m.rpc.mockImplementation(async (_name: string, args: { p_alert_ids: number[] }) => ({
    data: args.p_alert_ids,
    error: null,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clone-watch-month-end-liveness", () => {
  it("runs on the 1st at 01:00 UTC, before the 11:00 summary", () => {
    expect(fn.triggers).toContainEqual({ cron: "0 1 1 * *" });
  });

  it("snapshots every active-stock alert across chunks and records the Outcome Row", async () => {
    m.alerts = [
      ...Array.from({ length: 450 }, (_, i) => alert(i + 1)),
      alert(900, { lifecycle_state: "taken_down" }),
      alert(901, { triage_status: "fp" }),
    ];
    const out = await run();
    expect(out).toMatchObject({ stock: 450, probed: 450, notProbed: 0 });
    expect(new Set(m.upserts.map((u) => u.alert_id)).size).toBe(450);
    expect(m.upserts.every((u) => u.period_month === "2026-09-01" && u.status === "live")).toBe(true);
    expect(m.outcome).toHaveBeenCalledWith(
      "clone-watch-month-end-liveness",
      450,
      expect.objectContaining({ stock: 450, probed: 450, unverified: 0, not_probed: 0, dormancy_reset: 0 }),
    );
  });

  it("starts clean and writes the completion record LAST, after every snapshot row", async () => {
    m.alerts = Array.from({ length: 450 }, (_, i) => alert(i + 1));
    await run();
    expect(m.writes.slice(0, 2)).toEqual([
      "delete:clone_liveness_runs",
      "delete:clone_liveness_snapshots",
    ]);
    expect(m.writes.at(-1)).toBe("run");
    expect(m.writes.filter((w) => w === "run")).toHaveLength(1);
    expect(m.runs[0]).toMatchObject({ period_month: "2026-09-01", stock: 450, written: 450, unverified: 0 });
  });

  it("counts resolver failures as unverified, not probed (a bad resolver night pages)", async () => {
    m.alerts = Array.from({ length: 10 }, (_, i) => alert(i + 1));
    m.probe.mockResolvedValue({ a: { errorCode: "ESERVFAIL" }, aaaa: { errorCode: "ESERVFAIL" }, ns: { errorCode: "ESERVFAIL" } });
    const out = await run();
    expect(out).toMatchObject({ stock: 10, probed: 0, unverified: 10 });
    expect(m.runs[0]).toMatchObject({ written: 10, unverified: 10 });
  });

  it("refuses to snapshot any month but the one just closed (DNS answers today)", async () => {
    m.alerts = [alert(1)];
    await expect(run("2026-08")).rejects.toThrow(/just closed/);
    expect(m.writes).toEqual([]);
  });

  it("resets dead-dormant rows whose name now resolves, and counts them", async () => {
    m.alerts = [
      alert(1, { urlscan_uuid: null, urlscan_failure_streak: 8, urlscan_evidence: { status: "400" } }),
      alert(2, { urlscan_uuid: null, urlscan_failure_streak: 8, urlscan_evidence: { status: "400" } }),
      alert(3),
    ];
    m.probe.mockImplementation(async (h: string) =>
      h === "d2.com"
        ? { a: { errorCode: "ENOTFOUND" }, aaaa: { errorCode: "ENOTFOUND" }, ns: { errorCode: "ENOTFOUND" } }
        : { a: { records: ["1.2.3.4"] }, aaaa: null, ns: { records: ["ns1.x.com"] } },
    );
    await run();
    expect(m.rpc).toHaveBeenCalledWith("reset_clone_alert_dead_dormancy", { p_alert_ids: [1] });
    expect(m.outcome).toHaveBeenCalledWith(
      "clone-watch-month-end-liveness",
      3,
      expect.objectContaining({ dormancy_reset: 1 }),
    );
  });

  it("carries a short chunk's tail and marks what the chunk cap never reached as unverified", async () => {
    m.alerts = Array.from({ length: 250 }, (_, i) => alert(i + 1));
    const seen: number[][] = [];
    // Every chunk handles exactly ONE id (a budget cut after the first probe).
    m.chunkOverride = (input) => {
      const { ids, periodMonth } = input as { ids: number[]; periodMonth: string };
      seen.push(ids);
      return Promise.resolve({
        snapshots: [{ period_month: periodMonth, alert_id: ids[0], candidate_domain: "x", brand: "kmart.com.au", status: "live", dns: {}, checked_at: "t" }],
        handled: 1,
        dormantResolving: [],
      });
    };
    const out = await run();
    // chunk n starts where chunk n-1 stopped
    expect(seen.map((ids) => ids[0])).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(out).toMatchObject({ stock: 250, probed: 40, unverified: 210, notProbed: 210 });
    const unverified = m.upserts.filter((u) => u.status === "unverified");
    expect(unverified).toHaveLength(210);
    expect(unverified[0]).toMatchObject({ alert_id: 41, dns: { reason: "not_probed" } });
    // The record counts every row written, so the summary's count check holds.
    expect(m.runs[0]).toMatchObject({ stock: 250, written: 250, not_probed: 210 });
  });

  it("writes a quiet Outcome Row when there is no stock", async () => {
    m.alerts = [];
    await run();
    expect(m.outcome).toHaveBeenCalledWith(
      "clone-watch-month-end-liveness",
      0,
      expect.objectContaining({ reason: "no_stock", stock: 0 }),
    );
    // An empty stock is still a completed measurement.
    expect(m.runs[0]).toMatchObject({ stock: 0, written: 0 });
  });
});
