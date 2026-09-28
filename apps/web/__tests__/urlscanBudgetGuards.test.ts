import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The urlscan budget guards, run through the real lanes and route.
//
//   - lifecycle-recheck: a MANUAL fire reads every lane's unlisted spend and is
//     refused at 09:05 (the 09:00 submit batch owns that hour). A cron tick is
//     not guarded (its fit is proven statically in urlscanBudget.test.ts).
//   - urlscan-submit: the same guard on its manual trigger.
//   - admin "Scan now": its cap counts UNITS, not cost_telemetry rows.
//
// Go-red record (2026-09-28, each change made → the named test failed →
// reverted):
//   - recheck: guard condition `event?.name === MANUAL_EVENT` → `false`
//                  → "refuses a manual recheck at 09:05", "refuses when
//                    another lane already spent the hour" and "fails closed
//                    when the ledger is unreadable" FAILED
//   - recheck: guard applied to every run (condition → `true`)
//                  → "does not guard the scheduled tick" FAILED
//   - recheck: `!budget.ok` → `false` (the old own-rows cooldown's blind spot)
//                  → "refuses a manual recheck at 09:05", "refuses when
//                    another lane already spent the hour" and "fails closed
//                    when the ledger is unreadable" FAILED
//   - submit: guard condition → `false`
//                  → "refuses a manual submit 25 min before the 06:30
//                    recheck" FAILED
//   - decideUnlistedSpend: own-cap counted ROWS (`ownHour += 1`) instead of
//     units
//                  → "caps operator scans by units, not rows" FAILED
//   - admin route: 503 branch removed (unreadable fell through to the 429 path)
//                  → "fails closed (503) when the ledger is unreadable" FAILED
//   - checkUnlistedHeadroom: reservation insert removed (review of #1283)
//                  → "an admitted manual recheck reserves its batch: a manual
//                    submit a minute later is refused" FAILED
//   - checkUnlistedHeadroom: insert error ignored
//                  → "refuses when the reservation cannot be written" FAILED

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  ledger: { data: [] as unknown, error: null as unknown },
  /** Rows inserted into cost_telemetry (reservations); the ledger returns them. */
  inserted: [] as Array<Record<string, unknown>>,
  insertError: null as unknown,
  alert: { data: null as unknown, error: null as unknown },
  send: vi.fn(),
  log: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: {
    createFunction: (_c: unknown, _t: unknown, handler: unknown) => handler,
    send: mocks.send,
  },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, handler: unknown) => handler,
}));
function chain(result: () => unknown) {
  const c: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) => Promise.resolve(result()).then(r),
  };
  for (const m of ["select", "in", "gt", "gte", "eq", "order", "limit", "maybeSingle"])
    c[m] = () => c;
  return c;
}
function ledgerChain() {
  const c = chain(() =>
    Array.isArray(mocks.ledger.data)
      ? { data: [...(mocks.ledger.data as unknown[]), ...mocks.inserted], error: mocks.ledger.error }
      : mocks.ledger,
  );
  c.insert = async (row: Record<string, unknown>) => {
    if (mocks.insertError) return { error: mocks.insertError };
    mocks.inserted.push({ ...row, created_at: new Date().toISOString() });
    return { error: null };
  };
  return c;
}
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) =>
      table === "cost_telemetry" ? ledgerChain() : chain(() => mocks.alert),
  }),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: async () => false,
  isFeatureBrakedOrUnknown: async () => false,
  logCost: mocks.log,
}));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: mocks.log, logCostAsync: mocks.log }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: mocks.warn, debug: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: () => true }),
}));
vi.mock("@/lib/adminAuth", () => ({ requireAdmin: async () => undefined }));

import { cloneWatchLifecycleRecheck } from "@/app/api/inngest/functions/clone-watch-lifecycle-recheck";
import { cloneWatchUrlscanSubmit } from "@/app/api/inngest/functions/clone-watch-urlscan-submit";
import { POST as adminScan } from "@/app/api/admin/clone-watch/scan/route";

/** 2026-09-30 is a Wednesday. */
const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00Z`);
const ledgerRow = (operation: string, createdAt: Date, units: number) => ({
  feature: "shopfront_clone_urlscan",
  operation,
  created_at: createdAt.toISOString(),
  units,
  metadata: {},
});

const invoke = (handler: unknown, name: string) =>
  (handler as (ctx: unknown) => Promise<Record<string, unknown>>)({
    // A scheduled tick carries its cron expression (Inngest's real payload).
    event: {
      name,
      ts: Date.now(),
      data: name === CRON ? { cron: "30 */6 * * *" } : {},
    },
    step: { run: (_n: string, fn: () => unknown) => fn() },
    runId: "r1",
  });
const RECHECK_MANUAL = "shopfront/clone.lifecycle-recheck.manual-trigger.v1";
const SUBMIT_MANUAL = "shopfront/clone.urlscan-submit.manual-trigger.v1";
const CRON = "inngest/scheduled.timer";
const rpcNames = () => mocks.rpc.mock.calls.map(([n]) => n as string);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.clearAllMocks();
  vi.stubEnv("URLSCAN_API_KEY", "test");
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.ledger = { data: [], error: null };
  mocks.inserted = [];
  mocks.insertError = null;
  mocks.alert = { data: null, error: null };
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("lifecycle-recheck manual fire", () => {
  it("refuses a manual recheck at 09:05 (the submit batch owns the hour)", async () => {
    vi.setSystemTime(at("09:05"));
    const out = await invoke(cloneWatchLifecycleRecheck, RECHECK_MANUAL);
    expect(out).toMatchObject({ skipped: true, reason: "urlscan_budget_hourly_headroom" });
    expect(rpcNames()).not.toContain("list_clone_alerts_for_recheck");
    expect(mocks.warn).toHaveBeenCalled();
  });

  it("refuses when another lane already spent the hour (cross-lane, in units)", async () => {
    vi.setSystemTime(at("10:40"));
    mocks.ledger = { data: [ledgerRow("scan_one", at("10:30"), 15)], error: null };
    const out = await invoke(cloneWatchLifecycleRecheck, RECHECK_MANUAL);
    expect(out).toMatchObject({ skipped: true, reason: "urlscan_budget_hourly_headroom" });
  });

  it("fails closed when the ledger is unreadable", async () => {
    vi.setSystemTime(at("10:40"));
    mocks.ledger = { data: null, error: { message: "db down" } };
    const out = await invoke(cloneWatchLifecycleRecheck, RECHECK_MANUAL);
    expect(out).toMatchObject({ skipped: true, reason: "urlscan_budget_ledger_unreadable" });
    expect(rpcNames()).not.toContain("list_clone_alerts_for_recheck");
  });

  it("runs a manual recheck in a quiet window", async () => {
    vi.setSystemTime(at("10:40"));
    await invoke(cloneWatchLifecycleRecheck, RECHECK_MANUAL);
    expect(rpcNames()).toContain("list_clone_alerts_for_recheck");
  });

  it("an admitted manual recheck reserves its batch: a manual submit a minute later is refused", async () => {
    // Neither lane writes its real ledger row until the END of its run, so
    // without the reservation both read an empty hour and pass (165/h).
    vi.setSystemTime(at("10:30"));
    await invoke(cloneWatchLifecycleRecheck, RECHECK_MANUAL);
    expect(rpcNames()).toContain("list_clone_alerts_for_recheck");
    expect(mocks.inserted).toEqual([
      expect.objectContaining({
        operation: "manual_reservation",
        units: 90,
        metadata: expect.objectContaining({ spender: "recheck" }),
      }),
    ]);
    mocks.rpc.mockClear();
    vi.setSystemTime(at("10:31"));
    const out = await invoke(cloneWatchUrlscanSubmit, SUBMIT_MANUAL);
    expect(out).toMatchObject({
      skipped: true,
      reason: "urlscan_budget_hourly_headroom",
      budget: expect.objectContaining({ usedHour: 90 }),
    });
    expect(rpcNames()).not.toContain("list_clone_alerts_pending_urlscan_submit");
  });

  it("refuses when the reservation cannot be written", async () => {
    vi.setSystemTime(at("10:40"));
    mocks.insertError = { message: "insert failed" };
    const out = await invoke(cloneWatchLifecycleRecheck, RECHECK_MANUAL);
    expect(out).toMatchObject({ skipped: true, reason: "urlscan_budget_reservation_failed" });
    expect(rpcNames()).not.toContain("list_clone_alerts_for_recheck");
  });

  it("does not guard the scheduled tick", async () => {
    // Even with an unreadable ledger, the cron runs: its fit is static.
    vi.setSystemTime(at("06:30"));
    mocks.ledger = { data: null, error: { message: "db down" } };
    await invoke(cloneWatchLifecycleRecheck, CRON);
    expect(rpcNames()).toContain("list_clone_alerts_for_recheck");
  });
});

describe("urlscan-submit manual fire", () => {
  it("refuses a manual submit 25 min before the 06:30 recheck", async () => {
    vi.setSystemTime(at("06:05"));
    const out = await invoke(cloneWatchUrlscanSubmit, SUBMIT_MANUAL);
    expect(out).toMatchObject({ skipped: true, reason: "urlscan_budget_hourly_headroom" });
    expect(rpcNames()).not.toContain("list_clone_alerts_pending_urlscan_submit");
  });

  it("does not guard the 09:00 cron", async () => {
    vi.setSystemTime(at("09:00"));
    mocks.ledger = { data: null, error: { message: "db down" } };
    await invoke(cloneWatchUrlscanSubmit, CRON);
    expect(rpcNames()).toContain("list_clone_alerts_pending_urlscan_submit");
  });
});

describe("admin Scan now", () => {
  const req = () =>
    new Request("http://x/api/admin/clone-watch/scan", {
      method: "POST",
      body: JSON.stringify({ alertId: 7 }),
    });

  it("caps operator scans by units, not rows", async () => {
    // ONE row worth 20 units. The old cap counted rows (1 < 20) and let it through.
    vi.setSystemTime(at("10:40"));
    mocks.ledger = { data: [ledgerRow("scan_one", at("10:30"), 20)], error: null };
    const res = await adminScan(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "rate_limited", reason: "own_hourly_cap" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("counts other lanes' units against the key-wide hour", async () => {
    // One recheck_submit row = 100 submits: the old cap saw one row.
    vi.setSystemTime(at("10:40"));
    mocks.ledger = { data: [ledgerRow("recheck_submit", at("10:20"), 100)], error: null };
    const res = await adminScan(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ reason: "hourly_headroom" });
  });

  it("fails closed (503) when the ledger is unreadable", async () => {
    vi.setSystemTime(at("10:40"));
    mocks.ledger = { data: null, error: null };
    const res = await adminScan(req());
    expect(res.status).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("enqueues the scan when there is headroom", async () => {
    vi.setSystemTime(at("10:40"));
    mocks.ledger = { data: [ledgerRow("scan_one", at("10:30"), 19)], error: null };
    mocks.alert = {
      data: { id: 7, candidate_url: "https://c.example", candidate_domain: "c.example" },
      error: null,
    };
    const res = await adminScan(req());
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});
