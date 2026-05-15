import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  callTelstraSimSwap,
  callTelstraRetrieveDate,
  telstraProvider,
  _resetTelstraTokenCacheForTests,
} from "../telstra";

// Locks in the four behaviours that matter most for safe-by-default
// operation against a brand-new vendor surface:
//   1. Missing credentials degrade silently (no throw) — protects us if
//      Vercel envs land late.
//   2. Flag-off short-circuits before the OAuth call — avoids burning a
//      token request the moment the flag is flipped off in an incident.
//   3. The well-known "not enrolled / quota tripped" status codes
//      (401/403/404/422/429) degrade, not throw — orchestrator must be
//      free to fall back to Vonage or carrier-drift without a try/catch.
//   4. The OAuth bearer token is cached across calls inside the
//      `expires_in - 60s` window — a chatty `/check` call must not hammer
//      `/v2/oauth/token` once per request.
//
// Mocks fetch directly; no network and no real API key.

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => null), // telemetry skipped in tests
}));
vi.mock("../normalize", () => ({
  hashMsisdn: vi.fn(() => "test-hash"),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: {
    telstraSimSwap: true,
  },
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function tokenResponse(expiresIn = 3600) {
  return new Response(
    JSON.stringify({ access_token: "tok-abc", token_type: "Bearer", expires_in: expiresIn }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
function checkResponse(swapped: boolean, status = 200) {
  return new Response(JSON.stringify({ swapped }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function statusOnly(status: number) {
  return new Response("", { status });
}

describe("Telstra provider — credential + flag guards", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetTelstraTokenCacheForTests();
    delete process.env.TELSTRA_CLIENT_ID;
    delete process.env.TELSTRA_CLIENT_SECRET;
    delete process.env.TELSTRA_API_BASE;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("callTelstraSimSwap degrades silently when credentials missing", async () => {
    const r = await callTelstraSimSwap("+61412345678", { skipTelemetry: true });
    expect(r).toEqual({ kind: "degraded", reason: "telstra_not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("callTelstraRetrieveDate degrades silently when credentials missing", async () => {
    const r = await callTelstraRetrieveDate("+61412345678", { skipTelemetry: true });
    expect(r).toEqual({ kind: "degraded", reason: "telstra_not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("provider emits sim_swap unavailable=telstra_not_configured with no fetch", async () => {
    const result = await telstraProvider.run("+61412345678", {
      tier: "full",
      ownershipProven: true,
    });
    const pillar = Array.isArray(result) ? result[0]! : result;
    expect(pillar.id).toBe("sim_swap");
    expect(pillar.available).toBe(false);
    expect(pillar.reason).toBe("telstra_not_configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Telstra provider — happy path + graceful degradation", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _resetTelstraTokenCacheForTests();
    process.env.TELSTRA_CLIENT_ID = "id-test";
    process.env.TELSTRA_CLIENT_SECRET = "sec-test";
    process.env.TELSTRA_API_BASE = "https://tapi.test";
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns swapped=true and uses provided maxAge", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    fetchSpy.mockResolvedValueOnce(checkResponse(true));

    const r = await callTelstraSimSwap("+61412345678", {
      maxAge: 72,
      skipTelemetry: true,
    });

    expect(r).toEqual({ kind: "ok", swapped: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [, checkInit] = fetchSpy.mock.calls[1]!;
    const body = JSON.parse((checkInit as RequestInit).body as string);
    expect(body).toEqual({ phoneNumber: "+61412345678", maxAge: 72 });
  });

  it("returns swapped=false on clean number", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    fetchSpy.mockResolvedValueOnce(checkResponse(false));

    const r = await callTelstraSimSwap("+61412345678", { skipTelemetry: true });
    expect(r).toEqual({ kind: "ok", swapped: false });
  });

  it.each([401, 403, 404, 409, 422, 429])(
    "/check %i degrades, does not throw",
    async (status) => {
      fetchSpy.mockResolvedValueOnce(tokenResponse());
      fetchSpy.mockResolvedValueOnce(statusOnly(status));

      const r = await callTelstraSimSwap("+61412345678", { skipTelemetry: true });
      expect(r.kind).toBe("degraded");
      expect((r as { reason: string }).reason).toBe(`telstra_sim_swap_${status}`);
    },
  );

  it("/check 500 throws — orchestrator handles via allSettled", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    fetchSpy.mockResolvedValueOnce(statusOnly(500));

    await expect(
      callTelstraSimSwap("+61412345678", { skipTelemetry: true }),
    ).rejects.toThrow(/telstra_sim_swap_http:500/);
  });

  it("OAuth token is cached across multiple /check calls inside expires_in", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse(3600));
    fetchSpy.mockResolvedValueOnce(checkResponse(false));
    fetchSpy.mockResolvedValueOnce(checkResponse(false));
    fetchSpy.mockResolvedValueOnce(checkResponse(false));

    await callTelstraSimSwap("+61412345678", { skipTelemetry: true });
    await callTelstraSimSwap("+61412345678", { skipTelemetry: true });
    await callTelstraSimSwap("+61412345678", { skipTelemetry: true });

    // 1 token fetch + 3 /check fetches = 4 total
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    const tokenUrl = fetchSpy.mock.calls.filter((c: unknown[]) =>
      String(c[0]).includes("/oauth/token"),
    );
    expect(tokenUrl).toHaveLength(1);
  });

  it("/retrieve-date returns null latestSimChange + monitoredPeriod on clean", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ latestSimChange: null, monitoredPeriod: 1800 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const r = await callTelstraRetrieveDate("+61412345678", { skipTelemetry: true });
    expect(r).toEqual({ kind: "ok", latestSimChange: null, monitoredPeriod: 1800 });
  });

  it("provider returns available sim_swap pillar with detail.source=telstra", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    fetchSpy.mockResolvedValueOnce(checkResponse(true));
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          latestSimChange: "2026-02-07T03:14:00Z",
          monitoredPeriod: 1800,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await telstraProvider.run("+61412345678", {
      tier: "full",
      ownershipProven: true,
    });
    const pillar = Array.isArray(result) ? result[0]! : result;

    expect(pillar.id).toBe("sim_swap");
    expect(pillar.available).toBe(true);
    expect(pillar.score).toBe(80);
    expect(pillar.confidence).toBe(0.98);
    expect(pillar.detail).toMatchObject({
      source: "telstra",
      sim_swapped: true,
      most_recent_swap_at: "2026-02-07T03:14:00Z",
      monitored_period_days: 1800,
    });
  });

  it("provider degrades sim_swap when /check returns 404 (not a Telstra number)", async () => {
    fetchSpy.mockResolvedValueOnce(tokenResponse());
    fetchSpy.mockResolvedValueOnce(statusOnly(404));
    fetchSpy.mockResolvedValueOnce(statusOnly(404));

    const result = await telstraProvider.run("+61498765432", {
      tier: "full",
      ownershipProven: true,
    });
    const pillar = Array.isArray(result) ? result[0]! : result;

    expect(pillar.id).toBe("sim_swap");
    expect(pillar.available).toBe(false);
    expect(pillar.reason).toBe("telstra_sim_swap_404");
  });
});

describe("Telstra provider — flag off short-circuits", () => {
  beforeEach(() => {
    _resetTelstraTokenCacheForTests();
    process.env.TELSTRA_CLIENT_ID = "id-test";
    process.env.TELSTRA_CLIENT_SECRET = "sec-test";
  });

  it("returns sim_swap unavailable=telstra_disabled when flag off", async () => {
    vi.resetModules();
    vi.doMock("@askarthur/utils/feature-flags", () => ({
      featureFlags: { telstraSimSwap: false },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const fresh = await import("../telstra");
    fresh._resetTelstraTokenCacheForTests();

    const result = await fresh.telstraProvider.run("+61412345678", {
      tier: "full",
      ownershipProven: true,
    });
    const pillar = Array.isArray(result) ? result[0]! : result;

    expect(pillar.id).toBe("sim_swap");
    expect(pillar.available).toBe(false);
    expect(pillar.reason).toBe("telstra_disabled");
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
    vi.doUnmock("@askarthur/utils/feature-flags");
  });
});
