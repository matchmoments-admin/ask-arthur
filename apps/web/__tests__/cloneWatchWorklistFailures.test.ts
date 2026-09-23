import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A worklist read failure is a FAILURE, not a quiet day (PR B, 2026-09-23).
 *
 * Three clone-watch Lanes discarded the RPC `error` on their worklist read and
 * carried on with `[]`, so a broken read wrote the same `nothing_pending` /
 * `nothing_due` Outcome Row as a genuinely empty day — the silent-zero
 * detector could not tell them apart. The rule now, for every Lane: record the
 * Lane error (`recordLaneError`, so the digest shows it) and THROW (so Inngest
 * retries and a final failure is a failed run). Never a quiet Outcome Row.
 *
 * Also here: the re-emergence monitor calls a domain re-emerged only when it
 * points at a host again (A/AAAA) — a still-delegated zone is not a comeback.
 */

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  laneError: vi.fn(async () => {}),
  laneOutcome: vi.fn(async () => {}),
  resolvesToHost: vi.fn(),
  flags: {} as Record<string, boolean>,
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { createFunction: (_c: unknown, _t: unknown, h: unknown) => h, send: vi.fn() },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, h: unknown) => h,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@askarthur/scam-engine/lane-outcome", () => ({
  recordLaneError: m.laneError,
  recordLaneOutcome: m.laneOutcome,
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBrakedOrUnknown: async () => false,
  isFeatureBraked: async () => false,
  logCost: async () => {},
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: (_t, k: string) => m.flags[k] ?? false }),
}));
vi.mock("@/lib/clone-watch/liveness", () => ({
  resolvesToHost: m.resolvesToHost,
  probeLivenessDetailed: async () => new Map(),
}));
vi.mock("@/lib/clone-watch/enforcement-telemetry", () => ({
  logEnforcementEvent: vi.fn(),
}));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn(),
}));

import { cloneWatchNetcraftAuto } from "@/app/api/inngest/functions/clone-watch-netcraft-auto";
import { cloneWatchNetcraftReconcile } from "@/app/api/inngest/functions/clone-watch-netcraft-reconcile";
import { cloneWatchReemergenceMonitor } from "@/app/api/inngest/functions/clone-watch-reemergence-monitor";

type Handler = (ctx: unknown) => Promise<Record<string, unknown>>;
const invoke = (fn: unknown, data: unknown = {}) =>
  (fn as Handler)({
    event: { name: "cron", ts: Date.now(), data },
    step: { run: (_id: string, f: () => unknown) => f() },
    runId: "run-1",
  });

const failing = (rpcName: string) =>
  m.rpc.mockImplementation(async (name: string) =>
    name === rpcName
      ? { data: null, error: { message: "canceling statement due to statement timeout" } }
      : { data: [], error: null },
  );

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(m.flags)) delete m.flags[k];
});

describe("worklist read failures throw and record a Lane error — never a quiet row", () => {
  it("netcraft-auto /auto", async () => {
    Object.assign(m.flags, {
      shopfrontCloneNetcraftAuto: true,
      shopfrontCloneSubmitNetcraft: true,
      shopfrontCloneOutreach: true,
    });
    failing("list_clone_alerts_pending_netcraft_auto");
    await expect(invoke(cloneWatchNetcraftAuto)).rejects.toThrow(/statement timeout/);
    expect(m.laneError).toHaveBeenCalledWith(
      "shopfront-clone-netcraft-auto/auto",
      expect.stringContaining("statement timeout"),
      { stage: "load_candidates" },
    );
    expect(m.laneOutcome).not.toHaveBeenCalled();
  });

  it("netcraft-auto /resubmit", async () => {
    Object.assign(m.flags, {
      cloneNetcraftResubmit: true,
      shopfrontCloneSubmitNetcraft: true,
      shopfrontCloneOutreach: true,
    });
    failing("list_clone_alerts_pending_netcraft_resubmit");
    await expect(invoke(cloneWatchNetcraftAuto)).rejects.toThrow(/statement timeout/);
    expect(m.laneError).toHaveBeenCalledWith(
      "shopfront-clone-netcraft-auto/resubmit",
      expect.any(String),
      { stage: "load_candidates" },
    );
    expect(m.laneOutcome).not.toHaveBeenCalledWith(
      "shopfront-clone-netcraft-auto/resubmit",
      expect.anything(),
      expect.anything(),
    );
  });

  it("netcraft-reconcile", async () => {
    Object.assign(m.flags, { shopfrontCloneOutreach: true, cloneLifecycleReconcile: true });
    failing("list_clone_alerts_for_netcraft_reconcile");
    await expect(invoke(cloneWatchNetcraftReconcile)).rejects.toThrow(/statement timeout/);
    expect(m.laneError).toHaveBeenCalledWith(
      "shopfront-clone-netcraft-reconcile",
      expect.any(String),
      { stage: "load_worklist" },
    );
    expect(m.laneOutcome).not.toHaveBeenCalled();
  });

  it("reemergence-monitor", async () => {
    Object.assign(m.flags, { cloneEnforcement: true, cloneReemergenceMonitor: true });
    failing("list_takedown_cases_for_reemergence");
    await expect(invoke(cloneWatchReemergenceMonitor)).rejects.toThrow(/statement timeout/);
    expect(m.laneError).toHaveBeenCalledWith(
      "shopfront-clone-reemergence-monitor",
      expect.any(String),
      { stage: "load_actioned" },
    );
    expect(m.laneOutcome).not.toHaveBeenCalled();
  });
});

describe("re-emergence needs a host (A/AAAA), not just a delegated zone", () => {
  const cases = [
    { case_id: 1, clone_alert_id: 11, candidate_domain: "ns-only.example", channel: "apwg" },
  ];
  beforeEach(() => {
    Object.assign(m.flags, { cloneEnforcement: true, cloneReemergenceMonitor: true });
    m.rpc.mockImplementation(async (name: string) =>
      name === "list_takedown_cases_for_reemergence"
        ? { data: cases, error: null }
        : { data: null, error: null },
    );
  });

  it("a name with NS but no A/AAAA is checked, not re-emerged", async () => {
    m.resolvesToHost.mockResolvedValue(false);
    const out = await invoke(cloneWatchReemergenceMonitor);
    expect(m.resolvesToHost).toHaveBeenCalledWith("ns-only.example");
    expect(m.rpc).toHaveBeenCalledWith("mark_takedown_reemergence_checked", {
      p_case_id: 1,
      p_reemerged: false,
    });
    expect(out).toMatchObject({ reemerged: 0 });
  });

  it("an A/AAAA record again is a re-emergence", async () => {
    m.resolvesToHost.mockResolvedValue(true);
    const out = await invoke(cloneWatchReemergenceMonitor);
    expect(out).toMatchObject({ reemerged: 1 });
  });

  it("an inconclusive resolver leaves the case unstamped", async () => {
    m.resolvesToHost.mockResolvedValue(null);
    await invoke(cloneWatchReemergenceMonitor);
    expect(m.rpc).not.toHaveBeenCalledWith("mark_takedown_reemergence_checked", expect.anything());
  });
});
