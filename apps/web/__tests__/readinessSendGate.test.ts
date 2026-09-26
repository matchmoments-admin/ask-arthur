// The readiness gate (#1237) on every Clone Watch brand SEND path.
//
// Founder decision #1227: no brand is contacted until the scorecard reads ready
// for READINESS_REQUIRED_MONTHS consecutive closed months. This file proves,
// through the REAL route handlers (only I/O mocked), that:
//   - the stewardship send route refuses a REAL send when the scorecard is not
//     ready, not computed, or unreadable — and Resend is never called;
//   - the stewardship SHADOW send is untouched by the gate (existing behaviour);
//   - the brand-notify batch send route (no shadow mode) refuses likewise;
//   - notify-brand-prepare's auto-send cannot be on without a ready gate.
//
// Go-red record (2026-09-27, each guard removed → its test failed → restored):
//   - stewardship route: deleted the `if (!readiness.ready)` block
//        → "refuses a real send when … unreadable/not ready/not computed" FAILED (3)
//   - batch route: deleted the `if (!readiness.ready)` block
//        → "batch send refuses when not ready / unreadable" FAILED (2)
//   - readReadinessGate: initialised rows = [] instead of null (a read error
//     reads as "nothing computed" rather than "unreadable")
//        → still refused, but "refuses a real send when … unreadable" FAILED on
//          its reason assertion — the two states stay distinguishable
//   - resolveAutoSend: `flag === true || readiness?.ready === true`
//        → "auto-send needs flag AND ready" FAILED

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: vi.fn(),
  getAdminUserId: vi.fn().mockResolvedValue(null),
}));

const resendSend = vi.fn().mockResolvedValue({ data: { id: "msg_1" }, error: null });
vi.mock("resend", () => {
  class Resend {
    emails = { send: resendSend };
  }
  return { Resend };
});

vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/cost-telemetry", () => ({
  logCost: vi.fn(),
  PRICING: { RESEND_USD_PER_EMAIL: 0 },
}));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/unsubscribe", () => ({ signUnsubscribeUrl: () => "https://x/unsub" }));
vi.mock("@react-email/components", () => ({ render: vi.fn().mockResolvedValue("<p>x</p>") }));
vi.mock("@/emails/BrandStewardshipReport", () => ({ default: () => null }));
vi.mock("@/lib/email/brand-stewardship-clone-detections", () => ({
  cloneDetectionsFromMetrics: () => [],
}));

const flags = { brandStewardshipSend: true, shopfrontCloneOutreach: true, shopfrontCloneNotifyBrand: true };
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));

let shadowRecipient: string | null = null;
vi.mock("@askarthur/utils/env", () => ({
  readStringEnv: (name: string) =>
    name === "BRAND_STEWARDSHIP_SHADOW_RECIPIENT"
      ? shadowRecipient
      : name === "RESEND_FROM_EMAIL"
        ? "reports@askarthur.au"
        : null,
  readBoolEnv: () => false,
}));

// ── A fake service client: one chainable builder per table ──
type Res = { data: unknown; error: unknown };
let readiness: Res = { data: [], error: null };
const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
const tableResult: Record<string, Res> = {};
function builder(table: string) {
  const res = () =>
    table === "clone_watch_readiness" ? readiness : (tableResult[table] ?? { data: null, error: null });
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "update", "is", "not"]) {
    b[m] = () => b;
  }
  b.maybeSingle = async () => res();
  b.then = (ok: (v: Res) => unknown, bad: (e: unknown) => unknown) =>
    Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ from: (t: string) => builder(t), rpc }),
}));

const NOW = new Date("2026-10-15T00:00:00Z"); // required months: 2026-09, 2026-08
const READY = [
  { period_month: "2026-09-01", ready: true },
  { period_month: "2026-08-01", ready: true },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.RESEND_API_KEY = "re_test";
  shadowRecipient = null;
  readiness = { data: READY, error: null };
  resendSend.mockClear();
  rpc.mockClear();
  tableResult.brand_stewardship_reports = {
    data: {
      id: "r1",
      brand_key: "auspost.com.au",
      brand_name: "Australia Post",
      period_month: "2026-09-01",
      metrics: {},
      recipient_email: "security@auspost.com.au",
      status: "prepared",
      share_token: null,
    },
    error: null,
  };
  tableResult.brand_report_unsubscribes = { data: null, error: null };
  tableResult.known_brands = { data: { last_verified_at: "2026-09-01T00:00:00Z" }, error: null };
  // Batch route: an engaged brake is the first stop AFTER the gate, so a 503
  // cost_brake_engaged proves the gate let the request through.
  tableResult.feature_brakes = { data: { paused_until: "2099-01-01T00:00:00Z" }, error: null };
});
afterEach(() => vi.useRealTimers());

async function stewardshipSend() {
  const { POST } = await import("@/app/api/admin/brand-stewardship/[id]/send/route");
  const res = await POST(new NextRequest("https://x/api"), { params: Promise.resolve({ id: "r1" }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function batchSend() {
  const { POST } = await import("@/app/api/admin/clone-watch/batches/[batchId]/send/route");
  const res = await POST(new NextRequest("https://x/api"), {
    params: Promise.resolve({ batchId: "0b6c1f5e-8a55-4d3e-9a51-6a1d3c2b9e10" }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("stewardship send route — readiness gate", () => {
  it("refuses a real send when the scorecard is unreadable", async () => {
    readiness = { data: null, error: { message: "relation does not exist" } };
    const { status, body } = await stewardshipSend();
    expect(status).toBe(403);
    expect(body.error).toBe("not_ready");
    expect(String(body.detail)).toContain("scorecard_unreadable");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("refuses a real send when a required month is not ready", async () => {
    readiness = { data: [READY[0], { period_month: "2026-08-01", ready: false }], error: null };
    const { status, body } = await stewardshipSend();
    expect(status).toBe(403);
    expect(body.error).toBe("not_ready");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("refuses a real send when a required month was never computed", async () => {
    readiness = { data: [READY[0]], error: null };
    const { status, body } = await stewardshipSend();
    expect(status).toBe(403);
    expect(String(body.detail)).toContain("not_computed:2026-08-01");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("sends when both required months are ready (and the other gates pass)", async () => {
    const { status } = await stewardshipSend();
    expect(status).toBe(200);
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  it("leaves the SHADOW send untouched — it goes to our inbox even when not ready", async () => {
    shadowRecipient = "shadow@askarthur.au";
    readiness = { data: null, error: { message: "down" } };
    const { status, body } = await stewardshipSend();
    expect(status).toBe(200);
    expect(body.mode).toBe("shadow");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0][0].to).toEqual(["shadow@askarthur.au"]);
  });
});

describe("brand-notify batch send route — readiness gate", () => {
  it("batch send refuses when not ready", async () => {
    readiness = { data: [READY[0]], error: null };
    const { status, body } = await batchSend();
    expect(status).toBe(403);
    expect(body.error).toBe("not_ready");
    expect(rpc).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("batch send refuses when the scorecard is unreadable", async () => {
    readiness = { data: null, error: { message: "down" } };
    const { status, body } = await batchSend();
    expect(status).toBe(403);
    expect(body.error).toBe("not_ready");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("a ready scorecard lets the request reach the next gate (the cost brake)", async () => {
    const { status, body } = await batchSend();
    expect(status).toBe(503);
    expect(body.error).toBe("cost_brake_engaged");
  });
});

describe("notify-brand-prepare — auto-send needs flag AND ready", () => {
  it("auto-send needs flag AND ready", async () => {
    const { resolveAutoSend } = await import(
      "@/app/api/inngest/functions/clone-watch-notify-brand-prepare"
    );
    expect(resolveAutoSend(true, { ready: true })).toBe(true);
    expect(resolveAutoSend(true, { ready: false })).toBe(false);
    expect(resolveAutoSend(true, null)).toBe(false);
    // A replayed memo of another shape is not ready.
    expect(resolveAutoSend(true, { ready: "true" })).toBe(false);
    expect(resolveAutoSend(false, { ready: true })).toBe(false);
  });
});
