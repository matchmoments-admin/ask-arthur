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
  renderOutreachEmail,
  buildOutreachText,
  outreachIdempotencyKey,
  PILOT_TEMPLATE_BODY,
} from "@/lib/email/brand-outreach";
import type { OutreachCloneSample } from "@/lib/email/brand-outreach-clones";

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

// Service client — one chainable stub serves both the brand_outreach_log
// insert (recordOutreach) and the shopfront_clone_alerts select (the clone
// sample fetch). `cloneRows` is what the select chain resolves to; tests mutate
// it to exercise the data-section render.
const insertMock = vi.fn().mockResolvedValue({ error: null });
let cloneRows: unknown[] = [];
const sbStub = {
  insert: insertMock,
  select: vi.fn(() => sbStub),
  eq: vi.fn(() => sbStub),
  or: vi.fn(() => sbStub),
  gte: vi.fn(() => sbStub),
  order: vi.fn(() => sbStub),
  limit: vi.fn(() => Promise.resolve({ data: cloneRows, error: null })),
};
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ from: () => sbStub }),
}));

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
  cloneRows = [];
  delete process.env.BRAND_OUTREACH_SHADOW_RECIPIENT;
});

// ── Pure helpers ──

const SAMPLE: OutreachCloneSample = {
  brandDomain: "reece.com.au",
  total: 9,
  reported: 6,
  rows: [
    {
      domain: "reece-plumbing-au.click",
      classification: "likely_phishing",
      lifecycleState: "weaponised",
      firstSeenAt: "2026-07-10T00:00:00Z",
      ip: "1.2.3.4",
      asn: "AS132203",
      country: "US",
      registrar: "NameSilo, LLC",
    },
    {
      domain: "reece-rewards.top",
      classification: "parked_for_sale",
      lifecycleState: "declined",
      firstSeenAt: "2026-07-08T00:00:00Z",
      ip: null,
      asn: null,
      country: null,
      registrar: null,
    },
  ],
};

describe("renderOutreachEmail", () => {
  it("wraps the body with the ABN legal footer and a STOP line", async () => {
    const { html, text } = await renderOutreachEmail({
      brandName: "Reece",
      bodyMarkdown: "Hi, a pilot idea.",
    });
    expect(html).toContain("ABN 72 695 772 313");
    expect(html).toContain("Sydney");
    expect(html).toContain("Reece");
    expect(html.toUpperCase()).toContain("STOP");
    // text/plain twin exists and carries the signature — required for cold B2B
    expect(text).toContain("Founder, Ask Arthur");
    expect(text).toContain("ABN 72 695 772 313");
    expect(text.toUpperCase()).toContain("STOP");
  });

  it("renders markdown but escapes raw HTML pasted into the body", async () => {
    const { html } = await renderOutreachEmail({
      brandName: "Airwallex",
      bodyMarkdown: "**bold** and <script>alert(1)</script>",
    });
    expect(html).toContain("<strong>bold</strong>");
    expect(html).not.toContain("<script"); // neutralised to inert text
  });

  it("renders the live clone sample (domains + reported count) when provided", async () => {
    const { html, text } = await renderOutreachEmail({
      brandName: "Reece",
      bodyMarkdown: "Hi, a pilot idea.",
      cloneSample: SAMPLE,
    });
    expect(html).toContain("reece-plumbing-au.click");
    expect(html).toContain("9 lookalike domains");
    expect(html).toContain("reported 6 of them to a takedown vendor");
    expect(html).toContain("ACTIVE PHISHING"); // weaponised badge
    expect(html).toContain("+ 7 more"); // 9 total − 2 shown
    // text twin carries the sample too
    expect(text).toContain("reece-plumbing-au.click");
    expect(text).toContain("9 lookalike domains");
  });

  it("omits the data section entirely when the sample is empty", async () => {
    const { html } = await renderOutreachEmail({
      brandName: "Reece",
      bodyMarkdown: "Hi, a pilot idea.",
      cloneSample: { brandDomain: "reece.com.au", total: 0, reported: 0, rows: [] },
    });
    expect(html).not.toContain("already caught");
  });

  it("the shipped pilot template keeps an un-filled {{hook}} placeholder", () => {
    expect(PILOT_TEMPLATE_BODY).toContain("{{hook}}");
    expect(PILOT_TEMPLATE_BODY).toContain("A$300");
    expect(PILOT_TEMPLATE_BODY).toContain("First month free");
  });
});

describe("buildOutreachText", () => {
  it("appends a plain-text sample summary when a sample is present", () => {
    const text = buildOutreachText({
      brandName: "Reece",
      bodyMarkdown: "Hi.",
      cloneSample: SAMPLE,
    });
    expect(text).toContain("9 lookalike domains");
    expect(text).toContain("reported 6 of them");
    expect(text).toContain("- reece-plumbing-au.click (Likely phishing)");
    expect(text).toContain("(+ 7 more available on request)");
  });

  it("omits the sample block when there is no data", () => {
    const text = buildOutreachText({ brandName: "Reece", bodyMarkdown: "Hi." });
    expect(text).not.toContain("already caught");
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
    expect(payload.html).toContain("ABN 72 695 772 313");
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

  it("attaches the live clone sample when a worklist brandKey is supplied", async () => {
    cloneRows = [
      {
        candidate_domain: "pnbank-secure.click",
        urlscan_classification: "likely_phishing",
        urlscan_evidence: { server: { ip: "5.6.7.8", asn: "AS1", country: "US" } },
        attribution: { whois: { registrar: "NameSilo, LLC" } },
        submitted_to: { netcraft: { submitted_at: "2026-07-10T00:00:00Z" } },
        lifecycle_state: "weaponised",
        first_seen_at: "2026-07-10T00:00:00Z",
      },
    ];
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({ ...validPayload, testMode: true, brandKey: "pnbank.com.au" }),
    );
    expect(res.status).toBe(200);
    const [payload] = resendSendMock.mock.calls[0];
    expect(payload.html).toContain("pnbank-secure.click");
    expect(payload.html).toContain("already caught");
    // the select chain was actually exercised
    expect(sbStub.select).toHaveBeenCalled();
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

  it("503s when RESEND env is unset", async () => {
    const { POST } = await loadRoute();
    delete process.env.RESEND_API_KEY;
    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(503);
    expect(resendSendMock).not.toHaveBeenCalled();
  });
});
