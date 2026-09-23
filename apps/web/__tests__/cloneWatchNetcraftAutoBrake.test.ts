import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * netcraft-auto's auto lane has an operator kill-switch (review 2026-09-23 —
 * it was the one outbound clone-watch Lane without one). Engaged or
 * UNREADABLE (fail-closed) → no worklist read, no Netcraft POST. `{test:true}`
 * validation runs submit nothing and are not gated.
 */
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  laneError: vi.fn(async () => {}),
  laneOutcome: vi.fn(async () => {}),
  resolvesToHost: vi.fn(),
  flags: {} as Record<string, boolean>,
  braked: new Set<string>(),
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
vi.mock("@askarthur/scam-engine/lane-outcome", async (importOriginal) => ({
  // The real roster: Lanes read their brake key from it (LANE_SHAPES/LANES).
  LANES: (await importOriginal<typeof import("@askarthur/scam-engine/lane-outcome")>()).LANES,
  recordLaneError: m.laneError,
  recordLaneOutcome: m.laneOutcome,
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBrakedOrUnknown: async (k: string) => m.braked.has(k),
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

type Handler = (ctx: unknown) => Promise<Record<string, unknown>>;
const invoke = (data: unknown = {}) =>
  (cloneWatchNetcraftAuto as unknown as Handler)({
    event: { name: "cron", ts: Date.now(), data },
    step: { run: (_id: string, f: () => unknown) => f() },
    runId: "run-1",
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.braked.clear();
  m.rpc.mockResolvedValue({ data: [], error: null });
  Object.assign(m.flags, {
    shopfrontCloneNetcraftAuto: true,
    shopfrontCloneSubmitNetcraft: true,
    shopfrontCloneOutreach: true,
  });
});

describe("netcraft-auto /auto — clone_netcraft_auto brake", () => {
  it("engaged: skips before reading the worklist", async () => {
    m.braked.add("clone_netcraft_auto");
    const r = await invoke();
    expect(r).toMatchObject({ skipped: true, reason: "feature_brakes.clone_netcraft_auto engaged" });
    expect(m.rpc).not.toHaveBeenCalledWith("list_clone_alerts_pending_netcraft_auto", expect.anything());
  });

  it("clear: reads the worklist as normal", async () => {
    await invoke();
    expect(m.rpc).toHaveBeenCalledWith("list_clone_alerts_pending_netcraft_auto", expect.anything());
  });

  it("a {test:true} validation run is not gated", async () => {
    m.braked.add("clone_netcraft_auto");
    await invoke({ test: true });
    expect(m.rpc).toHaveBeenCalledWith("list_clone_alerts_pending_netcraft_auto", expect.anything());
  });
});
