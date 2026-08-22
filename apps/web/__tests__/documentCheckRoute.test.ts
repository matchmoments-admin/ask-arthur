import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/document-check — flag gate, rate limit, multipart validation, and the
// happy path THROUGH THE REAL Document Check Module (inspectDocument is pure
// and deterministic, so mocking it would only test the mock). Only the
// harness seams are mocked: flags, rate limit, logger, analytics.

const rateState = vi.hoisted(() => ({ allowed: true, storeDown: false }));
const flagState = vi.hoisted(() => ({ documentCheck: true }));
const events = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@askarthur/utils/rate-limit", () => ({
  checkDocumentUploadRateLimit: vi.fn(async () => {
    if (rateState.storeDown) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: null,
        message: "Service temporarily unavailable.",
        reason: "store_unavailable",
      };
    }
    return rateState.allowed
      ? { allowed: true, remaining: 4, resetAt: null, reason: "ok" }
      : {
          allowed: false,
          remaining: 0,
          resetAt: new Date(Date.now() + 60_000),
          message: "Too many document checks. Try again later.",
          reason: "exceeded",
        };
  }),
}));
vi.mock("@/lib/cost-telemetry", () => ({
  logCost: vi.fn((row: Record<string, unknown>) => {
    costRows.rows.push(row);
  }),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flagState }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/analytics-events", () => ({
  logEvent: vi.fn(async (ev: Record<string, unknown>) => {
    events.rows.push(ev);
  }),
}));
const costRows = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

import { POST } from "@/app/api/document-check/route";

// Minimal-but-real PDF bytes: header, an /Info dict, xref, trailer, %%EOF —
// then a genuine incremental update appended for the doctored case.
const CLEAN_PDF = Buffer.from(
  `%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n` +
    `4 0 obj\n<< /Producer (Xero Payroll) /CreationDate (D:20260801120000Z) /ModDate (D:20260801120000Z) >>\nendobj\n` +
    `xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 5 /Root 1 0 R /Info 4 0 R /ID [<aa> <aa>] >>\nstartxref\n9\n%%EOF\n`,
  "latin1",
);
const DOCTORED_PDF = Buffer.concat([
  CLEAN_PDF,
  Buffer.from(
    `4 0 obj\n<< /Producer (Adobe Photoshop 26.0) /ModDate (D:20260815093000Z) >>\nendobj\n` +
      `xref\n4 1\n0000000000 00000 n \ntrailer\n<< /Size 6 /Prev 9 /ID [<aa> <bb>] >>\nstartxref\n400\n%%EOF\n`,
    "latin1",
  ),
]);

function multipartRequest(
  bytes: Buffer,
  filename = "doc.pdf",
  surface?: string,
): NextRequest {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: "application/pdf" }));
  if (surface) form.append("surface", surface);
  return new NextRequest("http://localhost/api/document-check", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  rateState.allowed = true;
  rateState.storeDown = false;
  flagState.documentCheck = true;
  events.rows.length = 0;
  costRows.rows.length = 0;
});

describe("POST /api/document-check", () => {
  it("503s feature_disabled while dark", async () => {
    flagState.documentCheck = false;
    const res = await POST(multipartRequest(CLEAN_PDF));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("feature_disabled");
  });

  it("429s with Retry-After when rate limited — before any parse", async () => {
    rateState.allowed = false;
    const res = await POST(multipartRequest(DOCTORED_PDF));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("400s on non-multipart bodies", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/document-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/x.pdf" }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_mode");
  });

  it("422s on a non-PDF upload", async () => {
    const res = await POST(multipartRequest(Buffer.from("GIF89a not a pdf"), "img.gif"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("unsupported_file");
  });

  it("413s on an oversized content-length before reading the body", async () => {
    const req = new NextRequest("http://localhost/api/document-check", {
      method: "POST",
      headers: { "content-length": "99000000", "content-type": "multipart/form-data; boundary=x" },
      body: "x",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it("503s (not 429) when the rate-limit store is down — outage is not a quota hit", async () => {
    rateState.storeDown = true;
    const res = await POST(multipartRequest(CLEAN_PDF));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("service_unavailable");
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("returns checked:false scan_unavailable when the scan cannot run — never the clean state", async () => {
    // Passes the route's 5-byte %PDF- gate but fails the module's 8-byte
    // minimum: a scan that did not run must not render as zero findings.
    const res = await POST(multipartRequest(Buffer.from("%PDF-1", "latin1")));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(false);
    expect(data.reason).toBe("scan_unavailable");
    expect(data.structural).toBeNull();
  });

  it("returns named findings for a doctored PDF and fires the usage event", async () => {
    const res = await POST(multipartRequest(DOCTORED_PDF));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(true);
    // The AU pack runs on this surface; these fixtures carry no extractable
    // text, so the content layer honestly reports "nothing to read".
    expect(data.content).toEqual({ jurisdiction: "au", textExtracted: false, checks: [] });
    expect(data.docSha256).toMatch(/^[0-9a-f]{64}$/);
    const signals = data.findings.map((f: { signal: string }) => f.signal);
    expect(signals).toContain("multiple_revisions");
    expect(signals).toContain("producer_design_tool");
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.eventType).toBe("document_check_completed");
  });

  it("surface discriminator is allowlisted: inline maps, anything else falls back to web", async () => {
    await POST(multipartRequest(CLEAN_PDF, "doc.pdf", "inline"));
    await POST(multipartRequest(CLEAN_PDF, "doc.pdf", "spoofed-surface"));
    await POST(multipartRequest(CLEAN_PDF));
    const surfaces = costRows.rows.map(
      (r) => (r.metadata as Record<string, unknown>).surface,
    );
    expect(surfaces).toEqual([
      "document_check_inline",
      "document_check_web",
      "document_check_web",
    ]);
  });

  it("returns zero findings (never a verdict field) for a clean single-revision PDF", async () => {
    const res = await POST(multipartRequest(CLEAN_PDF));
    const data = await res.json();
    expect(data.checked).toBe(true);
    expect(data.findings).toEqual([]);
    // The response shape has no verdict/score field to misread.
    expect(data).not.toHaveProperty("verdict");
    expect(data).not.toHaveProperty("score");
    expect(data.structural.info.producer).toBe("Xero Payroll");
  });
});
