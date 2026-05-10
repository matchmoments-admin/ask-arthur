import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Pre-stage mocks BEFORE the dynamic import so the module under test picks
// them up at evaluation time (top-level imports of supabase server are not
// re-evaluated between tests).
const insertMock = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
const supabaseServiceMock = { from: fromMock };

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => supabaseServiceMock,
}));

const redisGet = vi.fn();
const redisSet = vi.fn().mockResolvedValue("OK");
class FakeRedis {
  get = redisGet;
  set = redisSet;
}
vi.mock("@upstash/redis", () => ({
  Redis: FakeRedis,
}));

// Helpers — must be created via dynamic import AFTER the mocks above.
async function importFresh() {
  return await import("../hibp");
}

const RAW_BREACH_FIXTURE = [
  {
    Name: "Adobe",
    Title: "Adobe",
    Domain: "adobe.com",
    BreachDate: "2013-10-04",
    DataClasses: ["Email addresses", "Password hints", "Passwords"],
  },
];

describe("HIBP cost telemetry — only on cache-miss upstream calls", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.HIBP_API_KEY = "test-key";
    process.env.UPSTASH_REDIS_REST_URL = "https://test.upstash";
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
    insertMock.mockClear();
    fromMock.mockClear();
    redisGet.mockReset();
    redisSet.mockClear();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.resetModules();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("logs ONE breach-check row on a 200 (breach found)", async () => {
    redisGet.mockResolvedValue(null); // cache miss
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify([{ Name: "Adobe" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { checkHIBP } = await importFresh();
    const result = await checkHIBP("test@example.com");

    expect(result.isBreached).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("cost_telemetry");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const insertArg = insertMock.mock.calls[0][0];
    expect(insertArg).toMatchObject({
      feature: "breach-check",
      provider: "hibp",
      operation: "lookup",
      units: 1,
      unit_cost_usd: 0,
      metadata: { outcome: "found", status: 200 },
    });
  });

  it("logs ONE breach-check row on a 404 (not breached — still upstream call)", async () => {
    redisGet.mockResolvedValue(null);
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));

    const { checkHIBP } = await importFresh();
    const result = await checkHIBP("clean@example.com");

    expect(result.isBreached).toBe(false);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].metadata).toEqual({
      outcome: "not_found",
      status: 404,
    });
  });

  it("logs ONE breach-check row on a 503 error", async () => {
    redisGet.mockResolvedValue(null);
    fetchSpy.mockResolvedValue(new Response(null, { status: 503 }));

    const { checkHIBP } = await importFresh();
    await checkHIBP("any@example.com");

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].metadata).toEqual({
      outcome: "error",
      status: 503,
    });
  });

  it("does NOT log on a cache hit", async () => {
    redisGet.mockResolvedValue({
      breachCount: 0,
      breachNames: [],
      isBreached: false,
    });

    const { checkHIBP } = await importFresh();
    await checkHIBP("cached@example.com");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("does NOT log when HIBP_API_KEY is missing (no upstream call made)", async () => {
    delete process.env.HIBP_API_KEY;

    const { checkHIBP } = await importFresh();
    await checkHIBP("any@example.com");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("checkHIBPDetailed: logs ONE row with operation='lookup_detailed' on 200", async () => {
    redisGet.mockResolvedValue(null);
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(RAW_BREACH_FIXTURE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const { checkHIBPDetailed } = await importFresh();
    const result = await checkHIBPDetailed("test@example.com");

    expect(result.breached).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      feature: "breach-check",
      operation: "lookup_detailed",
      metadata: { outcome: "found", status: 200 },
    });
  });

  it("checkHIBPDetailed: logs ONE row on a 404", async () => {
    redisGet.mockResolvedValue(null);
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));

    const { checkHIBPDetailed } = await importFresh();
    const result = await checkHIBPDetailed("clean@example.com");

    expect(result.breached).toBe(false);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].metadata).toEqual({
      outcome: "not_found",
      status: 404,
    });
  });

  it("checkHIBPDetailed: logs ONE row on transport error and re-throws", async () => {
    redisGet.mockResolvedValue(null);
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));

    const { checkHIBPDetailed } = await importFresh();
    await expect(checkHIBPDetailed("any@example.com")).rejects.toThrow(
      "ECONNRESET",
    );

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0].metadata).toEqual({
      outcome: "error",
      status: null,
    });
  });

  it("checkHIBPDetailed: does NOT log on cache hit", async () => {
    redisGet.mockResolvedValue({ breached: true, breachCount: 1, breaches: [] });

    const { checkHIBPDetailed } = await importFresh();
    await checkHIBPDetailed("cached@example.com");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });
});
