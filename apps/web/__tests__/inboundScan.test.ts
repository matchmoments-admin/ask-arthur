// Tests for /api/inbound-scan retry + no-silent-drops behaviour.
//
// Regression coverage for incident 2026-05-18: Anthropic Claude returned
// 529 (overloaded_error) on a user's forwarded email, the route returned
// 500 to the Cloudflare Email Worker, and the email was silently lost —
// no reply, no quarantine, no alert. Trust-destroying.
//
// The route must now:
//   1. Retry transient analyzeForBot failures (5xx, 408, 429, overloaded,
//      connection resets) up to 3 attempts with exponential backoff.
//   2. On terminal analyzeForBot failure, send an apology reply via
//      Resend and return 200 (so the Worker doesn't quarantine).
//   3. On legitimate rate-limit quota exceeded, send a polite "3/day
//      limit" reply instead of silent-dropping.
//   4. On rate-limit infra failure (Upstash blip), process the email
//      anyway and log at error level.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

const analyzeForBotMock = vi.fn();
vi.mock("@askarthur/bot-core/analyze", () => ({
  analyzeForBot: (...args: unknown[]) => analyzeForBotMock(...args),
}));

const checkRateLimitMock = vi.fn();
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkInboundScanRateLimit: (...args: unknown[]) =>
    checkRateLimitMock(...args),
}));

const loggerMock = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
vi.mock("@askarthur/utils/logger", () => ({ logger: loggerMock }));

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

// Stub the React Email render — the apology + quota replies are
// text-only so the actual HTML body is unused in those branches anyway.
vi.mock("@react-email/components", async () => {
  const actual =
    await vi.importActual<typeof import("@react-email/components")>(
      "@react-email/components",
    );
  return {
    ...actual,
    render: vi.fn(() => Promise.resolve("<html>stubbed</html>")),
  };
});

const logCostMock = vi.fn();
vi.mock("@/lib/cost-telemetry", () => ({
  logCost: (...args: unknown[]) => logCostMock(...args),
}));

vi.mock("@/lib/inbound-scan-feedback", () => ({
  buildFeedbackUrl: vi.fn(() => ({
    url: "https://askarthur.au/feedback?stub",
  })),
}));

// ── Helpers ──

function makePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source: "inbound_scan",
    external_id: "test-external-" + Math.random().toString(36).slice(2, 14),
    subject: "Your parcel could not be delivered",
    body_md:
      "Click here to reschedule: https://parcel-au-redelivery.example/x?ref=abc",
    from: "Test User <user@gmail.com>",
    to: "scan@askarthur-inbound.com",
    received_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeRequest(payload: ReturnType<typeof makePayload>) {
  return new NextRequest("https://askarthur.au/api/inbound-scan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": "test-secret",
      "x-real-ip": "1.2.3.4",
    },
    body: JSON.stringify(payload),
  });
}

// Pull the route under test AFTER mocks are installed. process.env must
// also be primed so the secret-check passes.
async function loadRoute() {
  process.env.INBOUND_EMAIL_WEBHOOK_SECRET = "test-secret";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Ask Arthur <test@askarthur.au>";
  return await import("@/app/api/inbound-scan/route");
}

// ── Tests ──

beforeEach(() => {
  vi.useFakeTimers();
  analyzeForBotMock.mockReset();
  checkRateLimitMock.mockReset();
  resendSendMock.mockReset();
  logCostMock.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  // Default happy paths
  checkRateLimitMock.mockResolvedValue({
    allowed: true,
    remaining: 2,
    resetAt: null,
    reason: "ok",
  });
  resendSendMock.mockResolvedValue({ data: { id: "msg_test_123" }, error: null });
});

describe("/api/inbound-scan — retry behaviour", () => {
  it("retries a 529 Overloaded twice then succeeds; replies once", async () => {
    const overloadedErr = new Error(
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    );
    analyzeForBotMock
      .mockRejectedValueOnce(overloadedErr)
      .mockRejectedValueOnce(overloadedErr)
      .mockResolvedValueOnce({
        verdict: "HIGH_RISK",
        confidence: 0.92,
        summary: "Phishing — fake parcel-redelivery lure.",
        redFlags: ["Spoofed sender", "Suspicious link"],
        nextSteps: ["Do not click", "Report to Scamwatch"],
      });

    const { POST } = await loadRoute();
    const responsePromise = POST(makeRequest(makePayload()));
    // Advance through the two 1s + 3s backoffs.
    await vi.advanceTimersByTimeAsync(5000);
    const res = await responsePromise;

    expect(analyzeForBotMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replySent).toBe(true);
    expect(body.verdict).toBe("HIGH_RISK");
    // Exactly one verdict reply went out.
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock.mock.calls[0][0].tags).toEqual([
      { name: "category", value: "inbound_scan_reply" },
    ]);
    // Retries logged at warn so operators can see transient spikes.
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it("on terminal analyzeForBot failure sends an apology reply (not silent 500)", async () => {
    const overloadedErr = new Error(
      '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    );
    analyzeForBotMock.mockRejectedValue(overloadedErr);

    const { POST } = await loadRoute();
    const responsePromise = POST(makeRequest(makePayload()));
    await vi.advanceTimersByTimeAsync(10000);
    const res = await responsePromise;

    expect(analyzeForBotMock).toHaveBeenCalledTimes(3);
    expect(res.status).toBe(200); // critically NOT 500 — worker mustn't quarantine
    const body = await res.json();
    expect(body.replySent).toBe(true);
    expect(body.reason).toBe("analysis_failed_apology");
    // Apology reply went out, tagged distinctly so analytics separates them.
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock.mock.calls[0][0].tags).toEqual([
      { name: "category", value: "inbound_scan_apology" },
    ]);
    // Error-level breadcrumb so the admin dashboard surfaces the spike.
    expect(loggerMock.error).toHaveBeenCalledWith(
      "inbound-scan: analyzeForBot failed after retries",
      expect.objectContaining({ sender: "user@gmail.com" }),
    );
    // cost_telemetry row recorded with the error shape.
    expect(logCostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "inbound_scan",
        operation: "email_forward_failed",
        metadata: expect.objectContaining({
          verdict: "ERROR",
          apology_sent: true,
        }),
      }),
    );
  });

  it("does NOT retry a non-transient error", async () => {
    analyzeForBotMock.mockRejectedValue(new Error("invalid_api_key (401)"));

    const { POST } = await loadRoute();
    const res = await POST(makeRequest(makePayload()));

    expect(analyzeForBotMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200); // apology reply still goes out
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock.mock.calls[0][0].tags).toEqual([
      { name: "category", value: "inbound_scan_apology" },
    ]);
  });
});

describe("/api/inbound-scan — rate-limit branches", () => {
  it("on user-quota-exceeded sends a polite reply, NOT silent 204", async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 3600_000),
      message: "limit",
      reason: "exceeded",
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest(makePayload()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reason).toBe("quota_exceeded");
    expect(body.replySent).toBe(true);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock.mock.calls[0][0].tags).toEqual([
      { name: "category", value: "inbound_scan_quota" },
    ]);
    // analyzeForBot must NOT run when the user is over quota — we
    // don't want to burn Claude spend on someone we won't reply to.
    expect(analyzeForBotMock).not.toHaveBeenCalled();
  });

  it("on Upstash store_unavailable processes the email anyway + logs error", async () => {
    checkRateLimitMock.mockResolvedValue({
      allowed: true, // fail-open
      remaining: 99,
      resetAt: null,
      reason: "store_unavailable",
    });
    analyzeForBotMock.mockResolvedValueOnce({
      verdict: "SUSPICIOUS",
      confidence: 0.6,
      summary: "Likely phishing.",
      redFlags: [],
      nextSteps: [],
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest(makePayload()));

    expect(res.status).toBe(200);
    expect(analyzeForBotMock).toHaveBeenCalledTimes(1);
    // Operator-visible breadcrumb for the infrastructure blip.
    expect(loggerMock.error).toHaveBeenCalledWith(
      "inbound-scan: rate limit store unavailable — processing anyway",
      expect.objectContaining({ sender: "user@gmail.com" }),
    );
  });
});
