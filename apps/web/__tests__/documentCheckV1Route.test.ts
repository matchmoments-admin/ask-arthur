import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/v1/document-checks — the B2B surface. Harness seams mocked (flag,
// guard, Redis meter, supabase, telemetry); the engine runs REAL.

const flagState = vi.hoisted(() => ({
  documentCheckV1Api: true,
  documentCheckRecords: false,
}));
const guardState = vi.hoisted(() => ({
  ok: true,
  orgId: "org-1" as string | null,
  tier: "business" as string,
}));
const meterState = vi.hoisted(() => ({ count: 1, down: false }));
const queries = vi.hoisted(() => ({ orgFilters: [] as string[] }));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flagState }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/v1-guard", () => ({
  guardV1: vi.fn(async () =>
    guardState.ok
      ? {
          ok: true,
          auth: {
            valid: true,
            orgId: guardState.orgId ?? undefined,
            tier: guardState.tier,
            keyHash: "kh-1",
          },
        }
      : { ok: false, error: new Response(JSON.stringify({ error: "Invalid or missing API key" }), { status: 401 }) },
  ),
}));
vi.mock("@upstash/redis", () => ({
  Redis: class {
    async incr() {
      if (meterState.down) throw new Error("redis down");
      return meterState.count;
    }
    async expire() {
      return 1;
    }
  },
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
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

// getRedis() short-circuits to null (→ fail-closed 503) without these.
process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

import { GET, POST } from "@/app/api/v1/document-checks/route";

const PDF = Buffer.from(
  `%PDF-1.7\n4 0 obj\n<< /Producer (Canva) >>\nendobj\ntrailer\n<< /Info 4 0 R >>\nstartxref\n9\n%%EOF\n` +
    `4 0 obj\n<< /Producer (Canva) >>\nendobj\ntrailer\n<< /Prev 9 >>\nstartxref\n150\n%%EOF\n`,
  "latin1",
);

function postReq(env: { url?: string } = {}): NextRequest {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(PDF)], "doc.pdf", { type: "application/pdf" }));
  return new NextRequest(env.url ?? "http://localhost/api/v1/document-checks", {
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
  meterState.count = 1;
  meterState.down = false;
  queries.orgFilters.length = 0;
});

describe("v1 document-checks", () => {
  it("both methods 503 while FF_DOCUMENT_CHECK_V1_API is off", async () => {
    flagState.documentCheckV1Api = false;
    expect((await GET(new NextRequest("http://localhost/api/v1/document-checks"))).status).toBe(503);
    expect((await POST(postReq())).status).toBe(503);
  });

  it("GET requires an organisation-linked key and scopes the query to that org", async () => {
    guardState.orgId = null;
    expect((await GET(new NextRequest("http://localhost/api/v1/document-checks"))).status).toBe(403);

    guardState.orgId = "org-1";
    const res = await GET(new NextRequest("http://localhost/api/v1/document-checks?period=7d"));
    expect(res.status).toBe(200);
    expect(queries.orgFilters).toEqual(["org-1"]);
  });

  it("POST 402s on a tier with no document allowance", async () => {
    guardState.tier = "free";
    const res = await POST(postReq());
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("plan_required");
  });

  it("POST 429s past the monthly allowance and 503s (fail-closed) when the meter is down", async () => {
    meterState.count = 1501; // business allowance is 1500
    expect((await POST(postReq())).status).toBe(429);

    meterState.count = 1;
    meterState.down = true;
    const res = await POST(postReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("POST happy path: real engine findings + monthlyRemaining", async () => {
    const res = await POST(postReq());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checked).toBe(true);
    expect(data.findings.map((f: { signal: string }) => f.signal)).toContain(
      "multiple_revisions",
    );
    expect(data.monthlyRemaining).toBe(1499);
  });
});
