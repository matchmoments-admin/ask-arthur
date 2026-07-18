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
  loggerMock.error.mockReset();
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
