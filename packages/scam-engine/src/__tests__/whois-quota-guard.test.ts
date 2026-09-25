import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  count: 0 as number | null,
  error: null as { message: string } | null,
  queries: 0,
}));
vi.mock("../cost-log", () => ({ logCost: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.gte = async () => {
        m.queries += 1;
        return { count: m.count, error: m.error };
      };
      return chain;
    },
  }),
}));

import {
  WHOISJSON_MONTHLY_GUARD,
  __resetWhoisQuotaCacheForTests,
  lookupWhois,
} from "../whois";

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ registrar: { name: "NameCheap, Inc." }, created: "2026-06-02" }),
}));

beforeEach(() => {
  process.env.WHOIS_API_KEY = "test-key";
  __resetWhoisQuotaCacheForTests();
  m.count = 0;
  m.error = null;
  m.queries = 0;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOIS_API_KEY;
});

// whoisjson's free tier is 1,000/month; the fleet ran ~1,200–1,300 (2026-09).
describe("whoisjson monthly quota guard", () => {
  it("interactive looks up below its 950 guard", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.interactive - 1;
    const r = await lookupWhois("x.shop", { priority: "interactive" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(r.registrar).toBe("NameCheap, Inc.");
  });

  it("interactive skips at 950", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.interactive;
    const r = await lookupWhois("x.shop", { priority: "interactive" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.registrar).toBeNull();
  });

  it("batch stops at 700 while interactive still has headroom", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.batch;
    await lookupWhois("a.shop", { priority: "batch" });
    expect(fetchMock).not.toHaveBeenCalled();
    await lookupWhois("b.shop", { priority: "interactive" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("defaults to interactive", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.batch + 10;
    await lookupWhois("x.shop");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails OPEN when the count can't be read (null count, no error)", async () => {
    m.count = null;
    await lookupWhois("x.shop", { priority: "batch" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches the count and advances it locally, so the guard trips without re-querying", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.interactive - 1;
    await lookupWhois("a.shop"); // 949 read, +1 locally → 950
    await lookupWhois("b.shop"); // cached 950 → skipped
    expect(m.queries).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
