import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/v1/document-checks — the B2B surface. Harness seams mocked (flag,
// guard, quota, supabase, telemetry); the engine runs REAL. The
// load-bearing assertions after the PR #1031 review: validation precedes
// metering (malformed uploads never burn paid units), org-linked keys are
// required, GET and POST carry distinct endpoint slugs.

const flagState = vi.hoisted(() => ({
  documentCheckV1Api: true,
  documentCheckRecords: false,
}));
const guardState = vi.hoisted(() => ({
  ok: true,
  orgId: "org-1" as string | null,
  tier: "business" as string,
  slugs: [] as Array<string | undefined>,
}));
const quotaState = vi.hoisted(() => ({
  mode: "allowed" as "allowed" | "exceeded" | "store_unavailable",
  used: 1,
  calls: 0,
}));
const queries = vi.hoisted(() => ({ orgFilters: [] as string[] }));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flagState }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/v1-guard", () => ({
  guardV1: vi.fn(async (_req: unknown, endpoint?: string) => {
    guardState.slugs.push(endpoint);
    return guardState.ok
      ? {
          ok: true,
          auth: {
            valid: true,
            orgId: guardState.orgId ?? undefined,
            tier: guardState.tier,
            keyHash: "kh-1",
          },
        }
      : {
          ok: false,
          error: new Response(JSON.stringify({ error: "Invalid or missing API key" }), {
            status: 401,
          }),
        };
  }),
}));
vi.mock("@/lib/v1-quota", () => ({
  consumeMonthlyQuota: vi.fn(async (_f: string, _scope: string, limit: number) => {
    quotaState.calls++;
    if (quotaState.mode === "store_unavailable") {
      return { allowed: false, reason: "store_unavailable" };
    }
    if (quotaState.mode === "exceeded") {
      return { allowed: false, reason: "exceeded", used: limit + 1, remaining: 0 };
    }
    return { allowed: true, used: quotaState.used, remaining: limit - quotaState.used };
  }),
  secondsToMonthEnd: vi.fn(() => 12345),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((col: string, val: string) => {
          if (col === "org_id") queries.orgFilters.push(val);
          return chain;
        }),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({ data: [], error: null })),
        insert: vi.fn(async () => ({ error: null })),
      };
      return chain;
    }),
  })),
}));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: vi.fn() }));
// Allowance resolver: mirror the tier fallback the real resolver applies so
// the quota assertions stay meaningful (business 1500, free 0). The
// resolver itself is unit-tested in documentCheckBilling.test.ts.
const allowanceState = vi.hoisted(() => ({ degraded: false }));
vi.mock("@/lib/document-allowance", () => ({
  documentAllowanceForOrg: vi.fn(async (_orgId: string, tier: string) => {
    const limits: Record<string, number> = { free: 0, pro: 200, business: 1500 };
    const monthlyLimit = limits[tier] ?? 0;
    return { monthlyLimit, source: "tier", plan: null, degraded: allowanceState.degraded };
  }),
}));

import { GET, POST } from "@/app/api/v1/document-checks/route";

const PDF = Buffer.from(
  `%PDF-1.7\n4 0 obj\n<< /Producer (Canva) >>\nendobj\ntrailer\n<< /Info 4 0 R >>\nstartxref\n9\n%%EOF\n` +
    `4 0 obj\n<< /Producer (Canva) >>\nendobj\ntrailer\n<< /Prev 9 >>\nstartxref\n150\n%%EOF\n`,
  "latin1",
);

function postReq(bytes: Buffer = PDF, filename = "doc.pdf"): NextRequest {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], filename, { type: "application/pdf" }));
  return new NextRequest("http://localhost/api/v1/document-checks", {
    method: "POST",
    body: form,
    headers: { authorization: "Bearer key" },
  });
}

beforeEach(() => {
  flagState.documentCheckV1Api = true;
  guardState.ok = true;
  guardState.orgId = "org-1";
  guardState.tier = "business";
  guardState.slugs.length = 0;
  quotaState.mode = "allowed";
  quotaState.used = 1;
  quotaState.calls = 0;
  queries.orgFilters.length = 0;
});

describe("v1 document-checks", () => {
  it("both methods 503 while FF_DOCUMENT_CHECK_V1_API is off", async () => {
    flagState.documentCheckV1Api = false;
    expect((await GET(new NextRequest("http://localhost/api/v1/document-checks"))).status).toBe(503);
    expect((await POST(postReq())).status).toBe(503);
  });

  it("GET and POST pass DISTINCT endpoint slugs so allowed_endpoints can separate them", async () => {
    await GET(new NextRequest("http://localhost/api/v1/document-checks"));
    await POST(postReq());
    expect(guardState.slugs).toEqual(["document-checks", "document-checks.submit"]);
  });

  it("both methods require an organisation-linked key", async () => {
    guardState.orgId = null;
    expect((await GET(new NextRequest("http://localhost/api/v1/document-checks"))).status).toBe(403);
    expect((await POST(postReq())).status).toBe(403);
    expect(quotaState.calls).toBe(0);
  });

  it("GET scopes the query to the caller's org", async () => {
    const res = await GET(new NextRequest("http://localhost/api/v1/document-checks?period=7d"));
    expect(res.status).toBe(200);
    expect(queries.orgFilters).toEqual(["org-1"]);
  });

  it("POST 402s on a tier with no document allowance — before any metering", async () => {
    guardState.tier = "free";
    const res = await POST(postReq());
    expect(res.status).toBe(402);
    expect(quotaState.calls).toBe(0);
  });

  it("degraded-zero allowance → 503 retryable, never the permanent-looking 402", async () => {
    guardState.tier = "free";
    allowanceState.degraded = true;
    const res = await POST(postReq());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("service_unavailable");
    expect(res.headers.get("Retry-After")).toBeTruthy();
    allowanceState.degraded = false;
  });

  it("malformed uploads NEVER consume the paid allowance (validate-before-meter)", async () => {
    // JSON body → 400
    const json = await POST(
      new NextRequest("http://localhost/api/v1/document-checks", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer key" },
        body: "{}",
      }),
    );
    expect(json.status).toBe(400);
    // Non-PDF upload → 422
    const gif = await POST(postReq(Buffer.from("GIF89a nope"), "img.gif"));
    expect(gif.status).toBe(422);
    expect(quotaState.calls).toBe(0);
  });

  it("POST 429s with a month-end Retry-After past the allowance; 503s fail-closed when the store is down", async () => {
    quotaState.mode = "exceeded";
    const res = await POST(postReq());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12345");

    quotaState.mode = "store_unavailable";
    expect((await POST(postReq())).status).toBe(503);
  });

  it("POST happy path: real engine findings + monthlyRemaining from the meter", async () => {
    quotaState.used = 7;
    const res = await POST(postReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(true);
    expect(data.findings.map((f: { signal: string }) => f.signal)).toContain(
      "multiple_revisions",
    );
    expect(data.monthlyRemaining).toBe(1493); // business 1500 - 7
    expect(quotaState.calls).toBe(1);
  });
});
