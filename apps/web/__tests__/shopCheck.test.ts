import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

import { featureFlags } from "@askarthur/utils/feature-flags";
import { checkShopSignalRateLimit } from "@askarthur/utils/rate-limit";
import { createServiceClient } from "@askarthur/supabase/server";
import { inngest } from "@askarthur/scam-engine/inngest/client";

import { POST } from "@/app/api/shop-check/route";
import { GET } from "@/app/api/shop-check/[id]/route";

// Replace featureFlags with a plain mutable object so tests can flip
// `shopSignal` without touching real env vars. Real flags are preserved.
vi.mock("@askarthur/utils/feature-flags", async (orig) => {
  const actual =
    await orig<typeof import("@askarthur/utils/feature-flags")>();
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, shopSignal: true },
  };
});
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkShopSignalRateLimit: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { send: vi.fn() },
}));

const VALID_ID = "22222222-2222-4222-8222-222222222222";

// The mock above makes featureFlags a plain object; the imported type is
// still readonly, so cast once for the per-test flag flips.
const flags = featureFlags as { shopSignal: boolean };

/**
 * A chainable Supabase stub. select()/eq() return the chain; maybeSingle()
 * resolves to `maybeSingleResult`; rpc() resolves to `rpcResult`.
 */
function makeSupabase(
  maybeSingleResult: unknown,
  rpcResult: { data: unknown; error: unknown } = { data: null, error: null },
) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(maybeSingleResult);
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return {
    client: { from: vi.fn(() => chain), rpc },
    rpc,
  };
}

function useSupabase(supabase: { from: unknown; rpc: unknown }) {
  vi.mocked(createServiceClient).mockReturnValue(
    supabase as unknown as ReturnType<typeof createServiceClient>,
  );
}

function postReq(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://askarthur.au/api/shop-check", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "203.0.113.7",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getReq() {
  return new NextRequest("https://askarthur.au/api/shop-check/x", {
    headers: { "x-real-ip": "203.0.113.7" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  flags.shopSignal = true;
  vi.mocked(checkShopSignalRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 100,
    resetAt: null,
    reason: "ok",
  });
});

describe("POST /api/shop-check", () => {
  it("404s when the shop-signal flag is off", async () => {
    flags.shopSignal = false;
    const res = await POST(postReq({ url: "https://shop.example.com/" }));
    expect(res.status).toBe(404);
  });

  it("400s on a malformed JSON body", async () => {
    const res = await POST(postReq("{not valid json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation_error");
  });

  it("400s when the body fails schema validation", async () => {
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("validation_error");
  });

  it("400s on a private/internal URL", async () => {
    const res = await POST(postReq({ url: "http://192.168.1.1/shop" }));
    expect(res.status).toBe(400);
  });

  it("429s when the rate limit is exceeded", async () => {
    vi.mocked(checkShopSignalRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
      reason: "exceeded",
      message: "Too many shop checks.",
    });
    const res = await POST(postReq({ url: "https://designer-bags.shop/cart" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("503s when the rate-limit store is unavailable", async () => {
    vi.mocked(checkShopSignalRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: null,
      reason: "store_unavailable",
    });
    const res = await POST(postReq({ url: "https://designer-bags.shop/cart" }));
    expect(res.status).toBe(503);
  });

  it("creates a row and emits the enrichment event on the happy path", async () => {
    const { client, rpc } = makeSupabase(
      { data: null },
      { data: "sc-created-uuid", error: null },
    );
    useSupabase(client);

    const res = await POST(
      postReq({
        url: "https://designer-bags.shop/cart",
        commerceFlags: ["sale-banner"],
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("sc-created-uuid");
    expect(rpc).toHaveBeenCalledWith("upsert_shop_check", expect.any(Object));
    expect(inngest.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(inngest.send).mock.calls[0][0]).toMatchObject({
      name: "shop.check.requested.v1",
    });
  });

  it("re-click guard returns the existing row without re-spending", async () => {
    const { client, rpc } = makeSupabase({ data: { id: "existing-uuid" } });
    useSupabase(client);

    const res = await POST(postReq({ url: "https://designer-bags.shop/cart" }));

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("existing-uuid");
    // No new row, no new Inngest event — a re-click must not re-spend.
    expect(rpc).not.toHaveBeenCalled();
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("503s when the upsert RPC fails", async () => {
    const { client } = makeSupabase(
      { data: null },
      { data: null, error: { message: "deadlock" } },
    );
    useSupabase(client);

    const res = await POST(postReq({ url: "https://designer-bags.shop/cart" }));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/shop-check/[id]", () => {
  it("404s when the shop-signal flag is off", async () => {
    flags.shopSignal = false;
    const res = await GET(getReq(), { params: Promise.resolve({ id: VALID_ID }) });
    expect(res.status).toBe(404);
  });

  it("400s on a non-uuid id", async () => {
    const res = await GET(getReq(), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("429s when the poll rate limit is exceeded", async () => {
    vi.mocked(checkShopSignalRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 30_000),
      reason: "exceeded",
      message: "Too many requests.",
    });
    const res = await GET(getReq(), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(429);
  });

  it("404s when the row does not exist", async () => {
    const { client } = makeSupabase({ data: null, error: null });
    useSupabase(client);
    const res = await GET(getReq(), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(404);
  });

  it("reports `processing` while enrichment has not written a result", async () => {
    const { client } = makeSupabase({
      data: {
        id: VALID_ID,
        url_normalized: "https://designer-bags.shop/cart",
        signal: { isCommerce: true },
      },
      error: null,
    });
    useSupabase(client);

    const res = await GET(getReq(), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("processing");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns the completed enrichment with a terminal cache header", async () => {
    const { client } = makeSupabase({
      data: {
        id: VALID_ID,
        url_normalized: "https://designer-bags.shop/cart",
        signal: {
          deepCheck: {
            status: "complete",
            compositeScore: 24,
            band: "low-concern",
          },
        },
      },
      error: null,
    });
    useSupabase(client);

    const res = await GET(getReq(), {
      params: Promise.resolve({ id: VALID_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("complete");
    expect(body.band).toBe("low-concern");
    expect(res.headers.get("Cache-Control")).toContain("max-age");
  });
});
