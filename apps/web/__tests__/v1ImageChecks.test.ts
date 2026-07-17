import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// /api/v1/image-checks — guardV1 gate, filters, cache header, and the
// privacy contract: install_id_hash and raw hive_result never leave.

const queryState = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  calls: { or: [] as string[], ilike: [] as string[], not: [] as string[] },
  selected: "",
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain = {
        select: vi.fn((cols: string) => {
          queryState.selected = cols;
          return chain;
        }),
        gte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() =>
          Object.assign(Promise.resolve({ data: queryState.rows, error: null }), chain),
        ),
        or: vi.fn((expr: string) => {
          queryState.calls.or.push(expr);
          return chain;
        }),
        ilike: vi.fn((col: string, v: string) => {
          queryState.calls.ilike.push(`${col}:${v}`);
          return chain;
        }),
        not: vi.fn((col: string, op: string) => {
          queryState.calls.not.push(`${col}:${op}`);
          return chain;
        }),
        then: undefined as unknown,
      };
      // Make the chain awaitable at any point after limit() — the route
      // awaits the final builder.
      const awaitable = Object.assign(chain, {
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: queryState.rows, error: null }),
      });
      return awaitable;
    }),
  })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
const guardState = vi.hoisted(() => ({ ok: true }));
vi.mock("@/lib/v1-guard", () => ({
  guardV1: vi.fn(async () =>
    guardState.ok
      ? { ok: true, apiKey: { id: 1, tier: "pro" } }
      : {
          ok: false,
          error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
        },
  ),
}));

import { GET } from "@/app/api/v1/image-checks/route";

function makeReq(qs = "") {
  return new NextRequest(`http://localhost/api/v1/image-checks${qs}`);
}

const ROW = {
  check_ref: "IC-0123456789AB",
  checked_at: "2026-07-17T05:00:00.000Z",
  image_url: "https://images.example.com/a.jpg",
  ai_confidence: 0.97,
  deepfake_confidence: 0.12,
  generator_source: "midjourney",
  impersonated_celebrity: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  guardState.ok = true;
  queryState.rows = [ROW];
  queryState.calls = { or: [], ilike: [], not: [] };
  queryState.selected = "";
});

describe("/api/v1/image-checks", () => {
  it("401s without a valid API key (guardV1)", async () => {
    guardState.ok = false;
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns checks with meta + cache header; never selects install_id_hash or hive_result", async () => {
    const res = await GET(makeReq("?period=7d"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    const json = await res.json();
    expect(json.meta.period_days).toBe(7);
    expect(json.checks).toHaveLength(1);
    expect(json.checks[0].check_ref).toBe("IC-0123456789AB");
    // Privacy contract: the SELECT itself must not request these columns.
    expect(queryState.selected).not.toContain("install_id_hash");
    expect(queryState.selected).not.toContain("hive_result");
  });

  it("min_confidence filters on EITHER signal (deepfake-only case preserved)", async () => {
    await GET(makeReq("?min_confidence=0.9"));
    expect(queryState.calls.or).toEqual([
      "ai_confidence.gte.0.9,deepfake_confidence.gte.0.9",
    ]);
  });

  it("generator + has_celebrity filters apply", async () => {
    await GET(makeReq("?generator=midjourney&has_celebrity=true"));
    expect(queryState.calls.ilike).toEqual(["generator_source:%midjourney%"]);
    expect(queryState.calls.not).toEqual(["impersonated_celebrity:is"]);
  });

  it("clamps period to 90d and ignores malformed values", async () => {
    const res = await GET(makeReq("?period=500d"));
    expect((await res.json()).meta.period_days).toBe(90);
    const res2 = await GET(makeReq("?period=banana"));
    expect((await res2.json()).meta.period_days).toBe(30);
  });
});
