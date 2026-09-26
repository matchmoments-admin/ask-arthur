// notify-brand-prepare auto-send is gated by the readiness scorecard (#1237).
//
// Runs the REAL prepare handler with the auto-send flag ON and a batch ready
// to go; only I/O is mocked. With the scorecard not ready (or unreadable) the
// batch is prepared for manual approval (auto_approved = false) and Resend is
// NEVER called. With it ready, the same run auto-sends — proving the test can
// see a send when one happens.
//
// Go-red record (2026-09-27, guard reverted → test failed → restored):
//   - prepare: `const autoSend = resolveAutoSend(flag, readiness)` reverted to
//     the bare flag `featureFlags.shopfrontCloneNotifyBrandAutoSend`
//        → "flag ON + scorecard not ready → no Resend call" FAILED
//        → "flag ON + scorecard unreadable → no Resend call" FAILED

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  send: vi.fn(async () => ({ data: { id: "msg_1" }, error: null })),
  rpc: vi.fn(),
  readiness: { data: [] as unknown, error: null as unknown },
}));

vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { createFunction: (_c: unknown, _t: unknown, h: unknown) => h },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_c: unknown, h: unknown) => h,
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: () => true }),
}));
vi.mock("@askarthur/utils/env", () => ({
  readStringEnv: () => "alerts@askarthur.au",
  readBoolEnv: () => false,
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("resend", () => {
  class Resend {
    emails = { send: m.send };
  }
  return { Resend };
});
vi.mock("@react-email/components", () => ({ render: async () => "<p>batch</p>" }));
vi.mock("@/emails/CloneWatchBrandAlert", () => ({ default: () => null }));
vi.mock("@/lib/email/resolve-copy", () => ({ resolveEmailCopy: async () => ({}) }));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/cost-telemetry", () => ({
  logCostAsync: vi.fn(async () => {}),
  PRICING: { RESEND_USD_PER_EMAIL: 0 },
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBrakedOrUnknown: async () => false,
}));
vi.mock("@askarthur/scam-engine/lane-outcome", async (orig) => ({
  LANES: (await orig<typeof import("@askarthur/scam-engine/lane-outcome")>()).LANES,
  recordLaneOutcome: vi.fn(async () => {}),
  recordLaneError: vi.fn(async () => {}),
}));

function builder(table: string) {
  const res = () =>
    table === "clone_watch_readiness" ? m.readiness : { data: [], error: null };
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order", "limit", "update", "neq", "is"]) b[k] = () => b;
  b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
    Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ from: builder, rpc: m.rpc }),
}));

import { cloneWatchNotifyBrandPrepare } from "@/app/api/inngest/functions/clone-watch-notify-brand-prepare";

type Handler = (ctx: unknown) => Promise<Record<string, unknown>>;
const run = () =>
  (cloneWatchNotifyBrandPrepare as unknown as Handler)({
    event: { name: "cron", data: {} },
    step: { run: (_id: string, f: () => unknown) => f() },
  });

// Months the gate requires relative to the real clock (the handler reads now).
function required(): [string, string] {
  const d = new Date();
  const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1));
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)];
}

const assignCalls = () =>
  m.rpc.mock.calls.filter((c) => c[0] === "assign_clone_alert_batch").map((c) => c[1]);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test";
  m.rpc.mockImplementation(async (name: string) => {
    if (name === "list_clone_alerts_unbatched_for_prepare") {
      return {
        data: [
          {
            id: 1, alert_id: 11, brand: "auspost.com.au", candidate_domain: "auspost-track.com",
            candidate_url: "https://auspost-track.com", recipient: "security@auspost.com.au",
            channel_type: "security_txt", severity_tier: "high", enqueued_at: "2026-09-20T00:00:00Z",
          },
        ],
        error: null,
      };
    }
    return { data: [], error: null };
  });
});

describe("notify-brand-prepare auto-send × readiness gate", () => {
  it("flag ON + scorecard not ready → no Resend call; batch left for manual approval", async () => {
    const [a, b] = required();
    m.readiness = { data: [{ period_month: a, ready: true }, { period_month: b, ready: false }], error: null };
    await run();
    expect(m.send).not.toHaveBeenCalled();
    expect(assignCalls()).toHaveLength(1);
    expect(assignCalls()[0]).toMatchObject({ p_auto_approved: false });
  });

  it("flag ON + scorecard unreadable → no Resend call", async () => {
    m.readiness = { data: null, error: { message: "relation does not exist" } };
    await run();
    expect(m.send).not.toHaveBeenCalled();
    expect(assignCalls()[0]).toMatchObject({ p_auto_approved: false });
  });

  it("flag ON + both required months ready → auto-sends (the test can see a send)", async () => {
    const [a, b] = required();
    m.readiness = { data: [{ period_month: a, ready: true }, { period_month: b, ready: true }], error: null };
    await run();
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(assignCalls()[0]).toMatchObject({ p_auto_approved: true });
  });
});
