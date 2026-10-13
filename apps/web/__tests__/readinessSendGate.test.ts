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
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "update", "is", "not", "contains"]) {
    b[m] = () => b;
  }
  // monitored_brands answers a list read (the subscriber lookup) and a single
  // read (the gate's subscriber_contact check) from the same fixture.
  b.maybeSingle = async () => {
    const r = res();
    return table === "monitored_brands" && Array.isArray(r.data)
      ? { data: r.data[0] ?? null, error: r.error }
      : r;
  };
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
  tableResult.monitored_brands = { data: [], error: null };
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
    // PR-C added the brake and the STOP-reply check to this path, so "the
    // other gates pass" now also means a clear brake and a not-suppressed answer.
    tableResult.feature_brakes = { data: null, error: null };
    rpc.mockResolvedValueOnce({ data: false, error: null });
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
  // PR-C: resolveAutoSend takes the Brand Send Gate's per-group decision
  // (`allowed`, which includes readiness) instead of the bare readiness gate.
  it("auto-send needs flag AND ready", async () => {
    const { resolveAutoSend } = await import(
      "@/app/api/inngest/functions/clone-watch-notify-brand-prepare"
    );
    expect(resolveAutoSend(true, { allowed: true })).toBe(true);
    expect(resolveAutoSend(true, { allowed: false })).toBe(false);
    expect(resolveAutoSend(true, null)).toBe(false);
    // A replayed memo of another shape is not ready.
    expect(resolveAutoSend(true, { allowed: "true" })).toBe(false);
    expect(resolveAutoSend(false, { allowed: true })).toBe(false);
  });
});

// ── PR-C: the Brand Send Gate closes the per-route copy gaps ──
// Go-red record (2026-09-28): "brake" removed from the stewardship-real profile
// → "stewardship refuses on an engaged brake" FAILED; "unsubscribe" removed
// from the batch profile → "batch refuses an unsubscribed recipient" FAILED.
describe("Brand Send Gate — gaps closed on the real routes", () => {
  afterEach(() => {
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("stewardship refuses on an engaged brake (it had no brake before PR-C)", async () => {
    // feature_brakes fixture is engaged by default.
    rpc.mockResolvedValue({ data: false, error: null });
    const { status, body } = await stewardshipSend();
    expect(status).toBe(503);
    expect(body.error).toBe("cost_brake_engaged");
    expect(resendSend).not.toHaveBeenCalled();
  });

  // PR-C review go-red: "legal_signoff" removed from the batch profile → this FAILED.
  it("batch refuses without the #371 sign-off (FF_BRAND_STEWARDSHIP_SEND OFF)", async () => {
    flags.brandStewardshipSend = false;
    try {
      const { status, body } = await batchSend();
      expect(status).toBe(403);
      expect(body.error).toBe("send_disabled");
      expect(rpc).not.toHaveBeenCalled();
      expect(resendSend).not.toHaveBeenCalled();
    } finally {
      flags.brandStewardshipSend = true;
    }
  });

  // PR-C review 2 go-red: the `isShadow && !isInternalRecipient(shadow)` guard
  // deleted → this FAILED (Resend called with the brand address).
  it("a shadow recipient outside @askarthur.au is refused — nothing sent", async () => {
    shadowRecipient = "security@auspost.com.au";
    const { status, body } = await stewardshipSend();
    expect(status).toBe(403);
    expect(body.error).toBe("shadow_recipient_not_internal");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("stewardship shadow send still ignores the brake", async () => {
    shadowRecipient = "shadow@askarthur.au";
    const { status, body } = await stewardshipSend();
    expect(status).toBe(200);
    expect(body.mode).toBe("shadow");
  });

  it("batch refuses an unsubscribed recipient (it only checked STOP replies before PR-C)", async () => {
    tableResult.feature_brakes = { data: null, error: null };
    tableResult.brand_contact_directory = {
      data: [{ recipient: "security@auspost.com.au", channel_type: "security_txt" }],
      error: null,
    };
    tableResult.brand_report_unsubscribes = { data: { email: "security@auspost.com.au" }, error: null };
    rpc.mockImplementation(async (name: string) =>
      name === "load_clone_alert_batch"
        ? {
            data: [
              {
                id: 1, alert_id: 11, brand: "auspost.com.au", candidate_domain: "auspost-x.com",
                recipient: "security@auspost.com.au", channel_type: "security_txt",
                approval_status: "pending", email_subject: "s", email_body_html: "<p>b</p>",
              },
            ],
            error: null,
          }
        : { data: false, error: null },
    );
    const { status, body } = await batchSend();
    expect(status).toBe(409);
    expect(body.error).toBe("recipient_unsubscribed");
    expect(resendSend).not.toHaveBeenCalled();
  });
});

// ── #1295: the Brand Subscriber's contact outranks the known_brands contact ──
// Go-red (2026-10-13): the route with `route` forced to the directory kind
// (the pre-#1295 recipient) FAILED "a real send goes to the subscriber's own
// contact". The #371 case is a guard, not a go-red: stewardship-real carries
// the same sign-off, so it passes either way — it pins that the subscriber
// path did not drop it.
describe("stewardship send — Brand Subscriber routing (#1295)", () => {
  const SUBSCRIBER = {
    id: 9,
    org_id: "o",
    brand_name: "Australia Post",
    brand_normalized: "australiapost",
    legitimate_domains: ["auspost.com.au"],
    plan: "brand_pilot",
    subscription_status: "active",
    verification_status: "verified",
    is_active: true,
    alert_contact_email: "fraud-team@auspost.com.au",
    alert_contact_name: null,
    stripe_subscription_id: null,
    activated_at: null,
  };
  afterEach(() => {
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it("a real send goes to the subscriber's own contact, not the known_brands one", async () => {
    tableResult.monitored_brands = { data: [SUBSCRIBER], error: null };
    tableResult.feature_brakes = { data: null, error: null };
    rpc.mockResolvedValue({ data: false, error: null });
    const { status } = await stewardshipSend();
    expect(status).toBe(200);
    expect(resendSend.mock.calls[0][0].to).toEqual(["fraud-team@auspost.com.au"]);
  });

  it("the subscriber send needs the #371 sign-off — nothing sent without it", async () => {
    tableResult.monitored_brands = { data: [SUBSCRIBER], error: null };
    tableResult.feature_brakes = { data: null, error: null };
    flags.brandStewardshipSend = false;
    try {
      const { status, body } = await stewardshipSend();
      expect(status).toBe(403);
      expect(body.error).toBe("send_disabled");
      expect(resendSend).not.toHaveBeenCalled();
    } finally {
      flags.brandStewardshipSend = true;
    }
  });

  it("a canceled subscriber falls back to the known_brands contact", async () => {
    tableResult.monitored_brands = {
      data: [{ ...SUBSCRIBER, subscription_status: "canceled" }],
      error: null,
    };
    tableResult.feature_brakes = { data: null, error: null };
    rpc.mockResolvedValue({ data: false, error: null });
    const { status } = await stewardshipSend();
    expect(status).toBe(200);
    expect(resendSend.mock.calls[0][0].to).toEqual(["security@auspost.com.au"]);
  });

  it("an unreadable subscriber store refuses (never falls back to unsolicited mail)", async () => {
    tableResult.monitored_brands = { data: null, error: { message: "down" } };
    const { status, body } = await stewardshipSend();
    expect(status).toBe(503);
    expect(body.error).toBe("subscriber_unreadable");
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("shadow mode still sends only to our inbox", async () => {
    tableResult.monitored_brands = { data: [SUBSCRIBER], error: null };
    shadowRecipient = "shadow@askarthur.au";
    const { status } = await stewardshipSend();
    expect(status).toBe(200);
    expect(resendSend.mock.calls[0][0].to).toEqual(["shadow@askarthur.au"]);
  });
});
