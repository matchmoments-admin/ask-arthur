// Tests for the founder-composed brand reach-out / pilot email.
//
// Two layers:
//   1. Pure helpers in @/lib/email/brand-outreach (email shape + idempotency).
//   2. The POST /api/admin/brand-outreach/send route — recipient routing
//      (shadow vs real), the multipart send shape, cost telemetry, Telegram
//      confirmation, and the Resend-failure alert path. Resend + requireAdmin
//      + Telegram + unsubscribe are mocked; the email-builder is real.
//
// Safety contract under test: testMode routes to the founder's OWN inbox and
// never the brand; a REAL send goes to `to`; there is exactly one recipient
// per request (no loop).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  buildOutreachEmail,
  outreachIdempotencyKey,
  PILOT_TEMPLATE_BODY,
} from "@/lib/email/brand-outreach";

// ── Mocks (installed before the route is imported) ──

const requireAdminMock = vi.fn();
vi.mock("@/lib/adminAuth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const resendSendMock = vi.fn();
vi.mock("resend", () => {
  class Resend {
    emails: { send: typeof resendSendMock };
    constructor(_apiKey: string) {
      this.emails = { send: resendSendMock };
    }
  }
  return { Resend };
});

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock("@askarthur/utils/logger", () => ({ logger: loggerMock }));
// The gate's override warn goes to Axiom via getLogger, not the console logger.
const axiomWarn = vi.fn();
const axiomFlush = vi.fn(async () => {});
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: axiomWarn, error: vi.fn(), flush: axiomFlush }),
}));

const logCostMock = vi.fn();
vi.mock("@/lib/cost-telemetry", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/cost-telemetry")>(
      "@/lib/cost-telemetry",
    );
  return { ...actual, logCost: (...args: unknown[]) => logCostMock(...args) };
});

const telegramMock = vi.fn();
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: (...args: unknown[]) => telegramMock(...args),
}));

vi.mock("@/lib/unsubscribe", () => ({
  signUnsubscribeUrl: (email: string, base: string) =>
    `${base}?email=${encodeURIComponent(email)}&token=stub`,
}));

// Service client — capture inserts into brand_outreach_log AND serve the clone
// sample the pilot send now embeds. One builder handles both surfaces: the
// insert path (brand_outreach_log) and the select-chain (shopfront_clone_alerts
// → getBrandCloneSample). `cloneSampleRows` is per-test mutable.
const insertMock = vi.fn().mockResolvedValue({ error: null });
// The gate's override record (cost_telemetry) — kept apart from the ledger.
const costInsertMock = vi.fn().mockResolvedValue({ error: null });
let cloneSampleRows: unknown[] = [];
// The Brand Send Gate's "outreach" profile (PR-C) reads the readiness
// scorecard for a REAL send: `select(...).in("period_month", months)`.
// Default READY for the two months the gate requires (real clock).
function requiredMonths(): [string, string] {
  const d = new Date();
  const a = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const b = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1));
  return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)];
}
const readyRows = () => requiredMonths().map((m) => ({ period_month: m, ready: true }));
let readinessRes: { data: unknown; error: unknown } = { data: [], error: null };
function makeQueryBuilder(table?: string): Record<string, unknown> {
  const b: Record<string, unknown> = {
    insert: table === "cost_telemetry" ? costInsertMock : insertMock,
    select: () => b,
    eq: () => b,
    gte: () => b,
    or: () => b,
    order: () => b,
    in: () => Promise.resolve(table === "clone_watch_readiness" ? readinessRes : { data: [], error: null }),
    limit: () => Promise.resolve({ data: cloneSampleRows, error: null }),
    // The gate's `unsubscribe` check (outreach profile, PR-C review).
    maybeSingle: () =>
      Promise.resolve(table === "brand_report_unsubscribes" ? unsubRes : { data: null, error: null }),
  };
  return b;
}
let unsubRes: { data: unknown; error: unknown } = { data: null, error: null };
let stopRes: { data: unknown; error: unknown } = { data: false, error: null };
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: (t: string) => makeQueryBuilder(t),
    rpc: async () => stopRes,
  }),
}));

let readinessOverride = false;
vi.mock("@askarthur/utils/env", async (orig) => {
  const actual = await orig<typeof import("@askarthur/utils/env")>();
  return {
    ...actual,
    readBoolEnv: (name: string) =>
      name === "BRAND_OUTREACH_READINESS_OVERRIDE" ? readinessOverride : actual.readBoolEnv(name),
  };
});

// ── Helpers ──

function makeRequest(payload: Record<string, unknown>) {
  return new NextRequest("https://askarthur.au/api/admin/brand-outreach/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function loadRoute() {
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Ask Arthur <brendan@askarthur.au>";
  process.env.ADMIN_TEST_EMAIL = "brendan@askarthur.au";
  return await import("@/app/api/admin/brand-outreach/send/route");
}

const validPayload = {
  to: "security@pnbank.com.au",
  brandName: "P&N Bank",
  subject: "A quick pilot idea",
  bodyMarkdown_or_html: "Hi there,\n\nWe run **clone-watch** for AU brands.\n\nBrendan",
};

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue(undefined);
  resendSendMock.mockReset().mockResolvedValue({ data: { id: "msg_1" }, error: null });
  logCostMock.mockReset();
  telegramMock.mockReset().mockResolvedValue(undefined);
  insertMock.mockReset().mockResolvedValue({ error: null });
  loggerMock.error.mockReset();
  cloneSampleRows = [];
  readinessRes = { data: readyRows(), error: null };
  readinessOverride = false;
  unsubRes = { data: null, error: null };
  stopRes = { data: false, error: null };
  loggerMock.warn.mockReset();
  costInsertMock.mockReset().mockResolvedValue({ error: null });
  delete process.env.BRAND_OUTREACH_SHADOW_RECIPIENT;
});

// ── Pure helpers ──

describe("buildOutreachEmail", () => {
  it("wraps the body with the ABN legal footer and a STOP line", () => {
    const { html, text } = buildOutreachEmail({
      brandName: "Reece",
      bodyMarkdown: "Hi, a pilot idea.",
    });
    expect(html).toContain("ABN 72 695 772 313");
    expect(html).toContain("Sydney");
    expect(html).toContain("Reece");
    // text/plain twin exists and carries the signature — required for cold B2B
    expect(text).toContain("Founder, Ask Arthur");
    expect(text).toContain("ABN 72 695 772 313");
    expect(text.toUpperCase()).toContain("STOP");
  });

  it("renders markdown but escapes raw HTML pasted into the body", () => {
    const { html } = buildOutreachEmail({
      brandName: "Airwallex",
      bodyMarkdown: "**bold** and <script>alert(1)</script>",
    });
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<script"); // neutralised to inert text
  });

  it("the shipped pilot template keeps an un-filled {{hook}} placeholder", () => {
    expect(PILOT_TEMPLATE_BODY).toContain("{{hook}}");
    expect(PILOT_TEMPLATE_BODY).toContain("A$300");
    expect(PILOT_TEMPLATE_BODY).toContain("First month free");
  });
});

describe("outreachIdempotencyKey", () => {
  const day = new Date("2026-07-18T09:00:00Z");
  it("is stable for the same recipient+subject+day", () => {
    expect(outreachIdempotencyKey("a@b.com", "Hi", day)).toBe(
      outreachIdempotencyKey("A@B.com", "Hi", day),
    );
  });
  it("differs when the subject changes", () => {
    expect(outreachIdempotencyKey("a@b.com", "Hi", day)).not.toBe(
      outreachIdempotencyKey("a@b.com", "Hello", day),
    );
  });
  it("is namespaced so it can't collide with other Resend keys", () => {
    expect(outreachIdempotencyKey("a@b.com", "Hi", day)).toMatch(/^brand-outreach:/);
  });
});

// ── Route ──

describe("POST /api/admin/brand-outreach/send", () => {
  it("requires admin", async () => {
    const { POST } = await loadRoute();
    await POST(makeRequest(validPayload));
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("400s on an invalid body (bad email / missing fields)", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...validPayload, to: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("testMode routes to the founder inbox — never the brand", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...validPayload, testMode: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.mode).toBe("shadow");
    expect(json.recipient).toBe("brendan@askarthur.au");

    const [payload, options] = resendSendMock.mock.calls[0];
    expect(payload.to).toEqual(["brendan@askarthur.au"]);
    expect(payload.to).not.toContain("security@pnbank.com.au");
    // subject is prefixed so a self-test is distinguishable in the inbox
    expect(payload.subject).toContain("[TEST → P&N Bank]");
    // multipart: both html and text present
    expect(payload.html).toContain("72 695 772 313");
    expect(typeof payload.text).toBe("string");
    expect(payload.text.length).toBeGreaterThan(0);
    // List-Unsubscribe (signed URL + mailto STOP) + stable idempotency key
    expect(payload.headers["List-Unsubscribe"]).toContain("/unsubscribe?email=");
    expect(payload.headers["List-Unsubscribe"]).toContain("mailto:");
    expect(options.idempotencyKey).toMatch(/^brand-outreach:/);

    expect(logCostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "brand_outreach",
        provider: "resend",
        metadata: expect.objectContaining({ mode: "shadow", brand: "P&N Bank" }),
      }),
    );
    expect(telegramMock).toHaveBeenCalled();
  });

  it("default (no testMode) sends the REAL email to the brand with the verbatim subject", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.mode).toBe("real");
    expect(json.recipient).toBe("security@pnbank.com.au");

    const [payload] = resendSendMock.mock.calls[0];
    expect(payload.to).toEqual(["security@pnbank.com.au"]);
    expect(payload.subject).toBe("A quick pilot idea"); // no [TEST] prefix
    expect(logCostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mode: "real" }),
      }),
    );
    // Ledgers a 'sent' row (brand_key null here — no worklist brandKey supplied).
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_key: null,
        brand_name: "P&N Bank",
        status: "sent",
        mode: "real",
        provider_message_id: "msg_1",
      }),
    );
  });

  it("passes the optional brandKey through and records a 'failed' row on reject", async () => {
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: "bounced" } });
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ ...validPayload, brandKey: "reece.com.au" }),
    );
    expect(res.status).toBe(502);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_key: "reece.com.au",
        status: "failed",
        mode: "real",
      }),
    );
  });

  it("BRAND_OUTREACH_SHADOW_RECIPIENT forces a shadow send even without testMode", async () => {
    process.env.BRAND_OUTREACH_SHADOW_RECIPIENT = "safe@askarthur.au";
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    const json = await res.json();
    expect(json.mode).toBe("shadow");
    expect(json.recipient).toBe("safe@askarthur.au");
    const [payload] = resendSendMock.mock.calls[0];
    expect(payload.to).toEqual(["safe@askarthur.au"]);
  });

  it("only ever sends to ONE recipient (no bulk loop)", async () => {
    const { POST } = await loadRoute();
    await POST(makeRequest(validPayload));
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    const [payload] = resendSendMock.mock.calls[0];
    expect(payload.to).toHaveLength(1);
  });

  it("returns 502 + a Telegram failure alert when Resend rejects; no cost logged", async () => {
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: "bad address" } });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(502);
    expect(logCostMock).not.toHaveBeenCalled();
    // the failure alert fired
    const alerted = telegramMock.mock.calls.some((c) =>
      String(c[0]).includes("FAILED"),
    );
    expect(alerted).toBe(true);
  });

  it("embeds the real clone sample (styled + honest) in the pilot email", async () => {
    cloneSampleRows = [
      {
        candidate_domain: "reece-login.click",
        inferred_target_domain: "reece.com.au",
        urlscan_classification: "likely_phishing",
        urlscan_evidence: { server: { ip: "1.2.3.4", asn: "AS132203", country: "US" } },
        urlscan_uuid: "uuid-1",
        attribution: { whois: { registrar: "NameSilo, LLC" } },
        submitted_to: { netcraft: { submitted_at: "2026-07-11T00:00:00Z" } },
        lifecycle_state: "weaponised",
        first_seen_at: "2026-07-10T00:00:00Z",
      },
    ];
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ ...validPayload, brandKey: "reece.com.au", testMode: true }),
    );
    expect(res.status).toBe(200);

    const [payload] = resendSendMock.mock.calls[0];
    // the styled evidence section + the real clone domain
    expect(payload.html).toContain("A sample of the lookalikes");
    expect(payload.html).toContain("reece-login.click");
    // honesty framing survives the send path
    expect(payload.html).toContain("not an assessment of your organisation");
    expect(payload.html.toLowerCase()).not.toContain("criminal");
    // the plain-text twin carries the evidence too (cold B2B needs text/plain)
    expect(payload.text).toContain("reece-login.click");
  });

  it("sends the pilot email without a sample section when no brandKey is supplied", async () => {
    cloneSampleRows = [{ candidate_domain: "should-not-appear.click" }];
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...validPayload, testMode: true }));
    expect(res.status).toBe(200);
    const [payload] = resendSendMock.mock.calls[0];
    // no brandKey → getBrandCloneSample short-circuits (no DB read), no sample
    expect(payload.html).not.toContain("A sample of the lookalikes");
    expect(payload.html).toContain("72 695 772 313");
  });

  it("503s when RESEND env is unset", async () => {
    const { POST } = await loadRoute();
    delete process.env.RESEND_API_KEY;
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(503);
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});

// Founder decision 2026-09-28 (PR-C): a REAL outreach send embeds real Clone
// Watch detections, so it passes the Brand Send Gate's "outreach" profile —
// readiness, with an explicit logged override.
//
// Go-red record (2026-09-28): deleted the `checkBrandSend("outreach", …)` block
// in the route → "a REAL send is refused not_ready …" FAILED (Resend called)
// and the scan test (brandSendGateScan) FAILED on this file; made settle()
// skip recordOverride → "the override lets it through …" FAILED.
describe("POST /api/admin/brand-outreach/send — Brand Send Gate", () => {
  it("a REAL send is refused not_ready when the scorecard is not ready — nothing sent, nothing ledgered", async () => {
    readinessRes = { data: [readyRows()[0]], error: null };
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...validPayload, brandKey: "pnbank.com.au" }));
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.error).toBe("not_ready");
    expect(String(json.detail)).toContain("not_computed");
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(logCostMock).not.toHaveBeenCalled();
  });

  it("an unreadable scorecard refuses too (fail closed)", async () => {
    readinessRes = { data: null, error: { message: "down" } };
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(403);
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("a test / shadow send is not gated (unchanged)", async () => {
    readinessRes = { data: null, error: { message: "down" } };
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...validPayload, testMode: true }));
    expect(res.status).toBe(200);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
  });

  it("the override lets it through, sends a flushed Axiom warn and writes a cost_telemetry record", async () => {
    readinessRes = { data: null, error: { message: "down" } };
    readinessOverride = true;
    axiomWarn.mockClear();
    axiomFlush.mockClear();
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ ...validPayload, brandKey: "pnbank.com.au" }));
    expect(res.status).toBe(200);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(axiomWarn).toHaveBeenCalledWith(
      "brand_send_gate_override",
      expect.objectContaining({ profile: "outreach", brand: "P&N Bank", brand_key: "pnbank.com.au" }),
    );
    expect(axiomFlush).toHaveBeenCalled();
    expect(costInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "brand_outreach",
        operation: "readiness_override",
        estimated_cost_usd: 0,
      }),
    );
  });

  // PR-C review (2026-09-28): outreach also checks unsubscribe / STOP, and its
  // unsubscribe link writes the store that check reads.
  // Go-red: "unsubscribe" removed from the outreach profile → the three
  // opt-out tests below FAILED (Resend called); UNSUBSCRIBE_BASE reverted to
  // "https://askarthur.au/unsubscribe" → "the unsubscribe link targets …" FAILED.
  it("a REAL send to an unsubscribed contact is refused — nothing sent", async () => {
    unsubRes = { data: { email: "security@pnbank.com.au" }, error: null };
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("recipient_unsubscribed");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("a REAL send to a STOP-replied contact is refused", async () => {
    stopRes = { data: true, error: null };
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect((await res.json()).error).toBe("recipient_suppressed");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("the readiness override never overrides an opt-out", async () => {
    readinessRes = { data: null, error: { message: "down" } };
    readinessOverride = true;
    unsubRes = { data: { email: "security@pnbank.com.au" }, error: null };
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect((await res.json()).error).toBe("recipient_unsubscribed");
    expect(resendSendMock).not.toHaveBeenCalled();
    expect(costInsertMock).not.toHaveBeenCalled();
  });

  // PR-C review 2 go-red: the `isShadow && !isInternalRecipient(recipient)`
  // guard deleted → both tests below FAILED (Resend called with the outside
  // address).
  it("a shadow recipient outside @askarthur.au is refused — nothing sent", async () => {
    process.env.BRAND_OUTREACH_SHADOW_RECIPIENT = "security@pnbank.com.au";
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("shadow_recipient_not_internal");
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("a testMode send to an outside ADMIN_TEST_EMAIL is refused", async () => {
    const { POST } = await loadRoute();
    process.env.ADMIN_TEST_EMAIL = "someone@example.com";
    try {
      const res = await POST(makeRequest({ ...validPayload, testMode: true }));
      expect(res.status).toBe(403);
      expect(resendSendMock).not.toHaveBeenCalled();
    } finally {
      process.env.ADMIN_TEST_EMAIL = "brendan@askarthur.au";
    }
  });

  it("the unsubscribe link targets the brand opt-out store the gate reads", async () => {
    const { POST } = await loadRoute();
    await POST(makeRequest(validPayload));
    const [payload] = resendSendMock.mock.calls[0];
    expect(payload.headers["List-Unsubscribe"]).toContain(
      "https://askarthur.au/api/brand-stewardship/unsubscribe?email=",
    );
    expect(payload.headers["List-Unsubscribe"]).toContain("&src=brand_outreach");
  });

  it("the override is not honoured if its record cannot be written", async () => {
    readinessRes = { data: null, error: { message: "down" } };
    readinessOverride = true;
    costInsertMock.mockResolvedValue({ error: { message: "insert failed" } });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("override_unrecorded");
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
