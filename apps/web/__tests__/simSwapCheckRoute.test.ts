import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks must be declared BEFORE the route is imported so vitest can
// inject them. Order matters: feature-flags first (read at module-load
// in some helpers), then everything else.

vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: {
    simSwapOnDemand: true,
  },
}));

vi.mock("@askarthur/utils/rate-limit", () => ({
  checkPhoneFootprintRateLimit: vi.fn(() =>
    Promise.resolve({ allowed: true, remaining: 59, resetAt: null }),
  ),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@askarthur/scam-engine/phone-footprint", () => ({
  hashMsisdn: vi.fn(() => "test-hash"),
  normalizePhoneE164: vi.fn((s: string) => (s.startsWith("+") ? s : null)),
  callTelstraSimSwap: vi.fn(),
  callTelstraRetrieveDate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getUser: vi.fn(),
  AuthUnavailableError: class extends Error {},
}));

vi.mock("@/lib/simSwapBeta", () => ({
  hasRedeemedSimSwapInvite: vi.fn(() => Promise.resolve(true)),
}));

// Mutable so each test can swap in a different `get()` return. The
// route caches the Redis instance at module scope (`_redis`), so the
// constructor-time binding is captured ONCE for the whole test file.
// Delegate via a method to dodge that — `redisInstance.get` is resolved
// per-call, not per-instantiation.
const redisInstance: { get: (k: string) => Promise<unknown> } = {
  get: async () => "1",
};
vi.mock("@upstash/redis", () => ({
  Redis: class {
    async get(key: string) {
      return redisInstance.get(key);
    }
  },
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/cost-telemetry", () => ({
  logCost: vi.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/sim-swap/check/route";
import {
  callTelstraSimSwap,
  callTelstraRetrieveDate,
} from "@askarthur/scam-engine/phone-footprint";
import { getUser } from "@/lib/auth";
import { hasRedeemedSimSwapInvite } from "@/lib/simSwapBeta";
import { createServiceClient } from "@askarthur/supabase/server";

const mockedCall = vi.mocked(callTelstraSimSwap);
const mockedDate = vi.mocked(callTelstraRetrieveDate);
const mockedGetUser = vi.mocked(getUser);
const mockedInvite = vi.mocked(hasRedeemedSimSwapInvite);
const mockedSupa = vi.mocked(createServiceClient);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://test/api/sim-swap/check", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function supaWithBrake(braked: boolean) {
  const rpc = vi.fn();
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: braked
        ? { paused_until: new Date(Date.now() + 60_000).toISOString() }
        : null,
    }),
  };
  return {
    rpc,
    from: vi.fn(() => builder),
  } as unknown as ReturnType<typeof createServiceClient>;
}

describe("POST /api/sim-swap/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.UPSTASH_REDIS_REST_URL = "http://redis";
    process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
    mockedGetUser.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as Awaited<ReturnType<typeof getUser>>);
    mockedInvite.mockResolvedValue(true);
    redisInstance.get = async () => "1";
  });

  it("401s when no session", async () => {
    mockedGetUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(401);
  });

  it("403s with invite_required when user is signed in but not in the beta", async () => {
    mockedInvite.mockResolvedValue(false);
    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("invite_required");
  });

  it("400s on invalid msisdn", async () => {
    const supa = supaWithBrake(false);
    mockedSupa.mockReturnValue(supa);
    const res = await POST(makeRequest({ msisdn: "not-a-phone" }));
    expect(res.status).toBe(400);
  });

  it("403s when no ownership proof in Redis", async () => {
    redisInstance.get = async () => null;
    const supa = supaWithBrake(false);
    mockedSupa.mockReturnValue(supa);
    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("ownership_not_verified");
  });

  it("503s when cost brake is active", async () => {
    const supa = supaWithBrake(true);
    mockedSupa.mockReturnValue(supa);
    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("cost_brake_active");
  });

  it("402s with upsell when no credits remain", async () => {
    const supa = supaWithBrake(false) as unknown as {
      rpc: ReturnType<typeof vi.fn>;
    } & ReturnType<typeof createServiceClient>;
    supa.rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "P0001", message: 'no_credits' },
    });
    mockedSupa.mockReturnValue(supa as ReturnType<typeof createServiceClient>);

    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("no_credits");
    expect(body.upsell.creditsPack5.checkoutUrl).toBe(
      "/api/sim-swap/credits/checkout?pack=5",
    );
  });

  it("returns 200 with swapped=false on a clean Telstra check", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ consumed_bucket: "free", free_remaining: 0, paid_remaining: 5 }],
      error: null,
    });
    const supa = supaWithBrake(false) as unknown as {
      rpc: typeof rpc;
    } & ReturnType<typeof createServiceClient>;
    supa.rpc = rpc;
    mockedSupa.mockReturnValue(supa as ReturnType<typeof createServiceClient>);

    mockedCall.mockResolvedValue({ kind: "ok", swapped: false });
    mockedDate.mockResolvedValue({
      kind: "ok",
      latestSimChange: null,
      monitoredPeriod: 1800,
    });

    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      swapped: false,
      recommendedAction: "proceed",
      consumedBucket: "free",
      creditsRemaining: { free: 0, paid: 5 },
    });
    // Only one RPC call — consume. No refund.
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("consume_sim_swap_credit", expect.any(Object));
  });

  it("returns 200 with swapped=true and recommendedAction=stop", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ consumed_bucket: "free", free_remaining: 0, paid_remaining: 0 }],
      error: null,
    });
    const supa = supaWithBrake(false) as unknown as {
      rpc: typeof rpc;
    } & ReturnType<typeof createServiceClient>;
    supa.rpc = rpc;
    mockedSupa.mockReturnValue(supa as ReturnType<typeof createServiceClient>);

    mockedCall.mockResolvedValue({ kind: "ok", swapped: true });
    mockedDate.mockResolvedValue({
      kind: "ok",
      latestSimChange: "2026-05-15T01:23:00Z",
      monitoredPeriod: 1800,
    });

    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.swapped).toBe(true);
    expect(body.recommendedAction).toBe("stop");
    expect(body.latestSimChange).toBe("2026-05-15T01:23:00Z");
  });

  it("refunds the credit and 503s when Telstra throws (5xx upstream)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ consumed_bucket: "free", free_remaining: 0, paid_remaining: 5 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ free_remaining: 1, paid_remaining: 5 }],
        error: null,
      });
    const supa = supaWithBrake(false) as unknown as {
      rpc: typeof rpc;
    } & ReturnType<typeof createServiceClient>;
    supa.rpc = rpc;
    mockedSupa.mockReturnValue(supa as ReturnType<typeof createServiceClient>);

    mockedCall.mockRejectedValue(new Error("telstra_sim_swap_http:500"));
    mockedDate.mockResolvedValue({
      kind: "ok",
      latestSimChange: null,
      monitoredPeriod: 0,
    });

    const res = await POST(makeRequest({ msisdn: "+61412345678" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("telstra_unavailable");
    expect(body.creditRefunded).toBe(true);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][0]).toBe("refund_sim_swap_credit");
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_user_id: "user-1",
      p_bucket: "free",
      p_reason: "refund_telstra_5xx",
    });
  });

  it("refunds + 422s when Telstra returns degraded (not a Telstra subscriber)", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ consumed_bucket: "paid", free_remaining: 0, paid_remaining: 4 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ free_remaining: 0, paid_remaining: 5 }],
        error: null,
      });
    const supa = supaWithBrake(false) as unknown as {
      rpc: typeof rpc;
    } & ReturnType<typeof createServiceClient>;
    supa.rpc = rpc;
    mockedSupa.mockReturnValue(supa as ReturnType<typeof createServiceClient>);

    mockedCall.mockResolvedValue({
      kind: "degraded",
      reason: "telstra_sim_swap_404",
    });
    mockedDate.mockResolvedValue({
      kind: "degraded",
      reason: "telstra_retrieve_date_404",
    });

    const res = await POST(makeRequest({ msisdn: "+61498765432" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("carrier_not_covered");
    expect(body.creditRefunded).toBe(true);

    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_bucket: "paid",
      p_reason: "refund_telstra_degraded",
    });
  });
});
