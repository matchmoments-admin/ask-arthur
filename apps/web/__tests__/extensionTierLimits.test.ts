import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Tier-aware extension rate limits (extension-monetisation PR 7).
// The load-bearing assertion is the FREE-TIER REGRESSION GUARD: every live
// install is on the free limiters, so their limits (10/min, 50/day) and
// Redis prefixes (askarthur:ext:burst / askarthur:ext:daily) must not move.

interface LimiterRecord {
  prefix: string;
  limiterArg: { tokens: number; window: string };
  limit: ReturnType<typeof vi.fn>;
}
const limiters = vi.hoisted(() => ({ created: [] as LimiterRecord[] }));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow(tokens: number, window: string) {
      return { tokens, window };
    }
    limit: ReturnType<typeof vi.fn>;
    constructor(opts: { prefix: string; limiter: { tokens: number; window: string } }) {
      this.limit = vi.fn(async () => ({
        success: true,
        remaining: 42,
        reset: Date.now() + 1000,
      }));
      limiters.created.push({
        prefix: opts.prefix,
        limiterArg: opts.limiter,
        limit: this.limit,
      });
    }
  }
  return { Ratelimit };
});

const redisMock = vi.hoisted(() => ({
  store: new Map<string, string>(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(function Redis() {
    return redisMock;
  }),
}));

const rpcMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({ rpc: rpcMock.fn })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@/app/api/extension/_lib/signature", () => ({
  verifyExtensionSignature: vi.fn(async () => ({ ok: true, installId: "install-a" })),
}));

import { validateExtensionRequest } from "@/app/api/extension/_lib/auth";

function makeReq(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/extension/analyze", {
    method: "POST",
    body: "{}",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // NOTE: limiters are module-level singletons in auth.ts — they persist
  // across tests within this file. Tests assert against the registry rather
  // than assuming a fresh module.
  redisMock.get.mockImplementation(async (k: string) => redisMock.store.get(k) ?? null);
  redisMock.set.mockImplementation(async (k: string, v: string) => {
    redisMock.store.set(k, v);
    return "OK";
  });
  redisMock.store.clear();
  rpcMock.fn.mockResolvedValue({ data: "free", error: null });
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
});

function limiterByPrefix(prefix: string): LimiterRecord | undefined {
  return limiters.created.find((l) => l.prefix === prefix);
}

describe("tier-aware extension rate limits", () => {
  it("REGRESSION GUARD: free installs get exactly 10/min + 50/day on the original prefixes", async () => {
    const result = await validateExtensionRequest(makeReq());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.tier).toBe("free");

    const burst = limiterByPrefix("askarthur:ext:burst");
    const daily = limiterByPrefix("askarthur:ext:daily");
    expect(burst).toBeDefined();
    expect(daily).toBeDefined();
    expect(burst!.limiterArg).toEqual({ tokens: 10, window: "1 m" });
    expect(daily!.limiterArg).toEqual({ tokens: 50, window: "24 h" });
    expect(burst!.limit).toHaveBeenCalled();
    expect(daily!.limit).toHaveBeenCalled();
    // Pro limiters must NOT have been consulted for a free install.
    expect(limiterByPrefix("askarthur:ext:burst:pro")?.limit.mock.calls.length ?? 0).toBe(0);
  });

  it("pro installs get 30/min + 500/day on tier-suffixed prefixes", async () => {
    rpcMock.fn.mockResolvedValue({ data: "pro", error: null });
    const result = await validateExtensionRequest(makeReq());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.tier).toBe("pro");

    const burst = limiterByPrefix("askarthur:ext:burst:pro");
    const daily = limiterByPrefix("askarthur:ext:daily:pro");
    expect(burst!.limiterArg).toEqual({ tokens: 30, window: "1 m" });
    expect(daily!.limiterArg).toEqual({ tokens: 500, window: "24 h" });
    expect(burst!.limit).toHaveBeenCalled();
    expect(daily!.limit).toHaveBeenCalled();
  });

  it("caches the tier in Redis — second request skips the RPC", async () => {
    await validateExtensionRequest(makeReq());
    expect(rpcMock.fn).toHaveBeenCalledTimes(1);
    await validateExtensionRequest(makeReq());
    expect(rpcMock.fn).toHaveBeenCalledTimes(1);
  });

  it("fails open to free when the tier RPC throws", async () => {
    rpcMock.fn.mockRejectedValue(new Error("db down"));
    const result = await validateExtensionRequest(makeReq());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.tier).toBe("free");
  });

  it("email scans keep flat email limits even for pro installs", async () => {
    rpcMock.fn.mockResolvedValue({ data: "pro", error: null });
    const before = limiterByPrefix("askarthur:ext:email:burst")?.limit.mock.calls.length ?? 0;
    const result = await validateExtensionRequest(makeReq({ "x-scan-source": "email" }));
    expect(result.valid).toBe(true);
    const emailBurst = limiterByPrefix("askarthur:ext:email:burst");
    expect(emailBurst).toBeDefined();
    expect(emailBurst!.limiterArg).toEqual({ tokens: 20, window: "1 m" });
    expect(emailBurst!.limit.mock.calls.length).toBe(before + 1);
  });
});
