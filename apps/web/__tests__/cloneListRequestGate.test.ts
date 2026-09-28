// api/clone-list-request × the Brand Send Gate ("requester" profile).
//
// The lead magnet mails a brand's lookalike list (shopfront_clone_alerts) to
// the work email that asked for it. PR-C review 2 routed it through the gate:
// flag, the shopfront_clone_outreach brake and opt-outs. A recipient-level
// refusal answers one generic code so this public route never reveals whether
// an address has opted out.
//
// Go-red (2026-09-28): the route's checkBrandSend("requester", …) block
// deleted → "an opted-out work email gets not_deliverable" and "an engaged
// brake refuses" FAILED (Resend called); the scan test FAILED naming this
// route.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  send: vi.fn(async () => ({ data: { id: "msg_1" }, error: null })),
  braked: false,
  unsub: { data: null as unknown, error: null as unknown },
  stop: { data: false as unknown, error: null as unknown },
}));

vi.mock("resend", () => {
  class Resend {
    emails = { send: m.send };
  }
  return { Resend };
});
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: new Proxy({}, { get: () => true }),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkFormRateLimit: async () => ({ allowed: true }),
}));
vi.mock("@/lib/analytics-events", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/clone-watch/resolve-brand", () => ({
  resolveWatchlistBrand: async () => ({ brand: "Australia Post", legitimate_domains: ["auspost.com.au"] }),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBrakedOrUnknown: async () => m.braked,
}));

function builder(table: string) {
  const res = () =>
    table === "brand_report_unsubscribes"
      ? m.unsub
      : table === "shopfront_clone_alerts"
        ? { data: [{ candidate_domain: "auspost-x.com", first_seen_at: "2026-09-01T00:00:00Z", urlscan_classification: null }], error: null }
        : { data: null, error: null };
  const b: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "order", "limit"]) b[k] = () => b;
  b.maybeSingle = async () => res();
  b.insert = async () => ({ error: null });
  b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
    Promise.resolve(res()).then(ok, bad);
  return b;
}
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ from: builder, rpc: async () => m.stop }),
}));

import { POST } from "@/app/api/clone-list-request/route";

const call = async () => {
  const res = await POST(
    new NextRequest("https://askarthur.au/api/clone-list-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "security@auspost.com.au", brand: "Australia Post", consent: true }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  m.send.mockClear();
  m.braked = false;
  m.unsub = { data: null, error: null };
  m.stop = { data: false, error: null };
});

describe("clone-list-request × requester profile", () => {
  it("sends the list when the gate allows", async () => {
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.monitored).toBe(true);
    expect(m.send).toHaveBeenCalledTimes(1);
  });

  it("an opted-out work email gets not_deliverable — nothing sent, reason not revealed", async () => {
    m.unsub = { data: { email: "security@auspost.com.au" }, error: null };
    const { status, body } = await call();
    expect(status).toBe(409);
    expect(body).toEqual({ error: "not_deliverable" });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("a STOP-replied work email is refused the same way", async () => {
    m.stop = { data: true, error: null };
    const { body } = await call();
    expect(body.error).toBe("not_deliverable");
    expect(m.send).not.toHaveBeenCalled();
  });

  it("an engaged brake refuses", async () => {
    m.braked = true;
    const { status, body } = await call();
    expect(status).toBe(503);
    expect(body.error).toBe("cost_brake_engaged");
    expect(m.send).not.toHaveBeenCalled();
  });
});
