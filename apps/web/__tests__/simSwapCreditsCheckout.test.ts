import { describe, it, expect, beforeEach, vi } from "vitest";

// Verifies the two gates that PR 4 added to the credits-checkout
// endpoint: the simSwapOnDemand flag, and the invite-redemption check.
// Before this PR a signed-in user could hit checkout while the feature
// flag was off OR before they had a beta invite — both bugs.

vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { simSwapOnDemand: true },
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({
  getUser: vi.fn(),
  AuthUnavailableError: class extends Error {},
}));

vi.mock("@/lib/simSwapBeta", () => ({
  hasRedeemedSimSwapInvite: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({}) as unknown),
}));

vi.mock("@/lib/stripe", () => ({
  stripe: {
    checkout: {
      sessions: {
        create: vi.fn(() =>
          Promise.resolve({ url: "https://checkout.stripe.com/test_session" }),
        ),
      },
    },
  },
  getOrCreateStripeCustomer: vi.fn(() => Promise.resolve("cus_test")),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/sim-swap/credits/checkout/route";
import { getUser } from "@/lib/auth";
import { hasRedeemedSimSwapInvite } from "@/lib/simSwapBeta";

const mockedGetUser = vi.mocked(getUser);
const mockedInvite = vi.mocked(hasRedeemedSimSwapInvite);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://test/api/sim-swap/credits/checkout", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/sim-swap/credits/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK = "price_5pack";
    process.env.STRIPE_PRICE_SIM_SWAP_RECOVERY_CHECK = "price_recovery";
    mockedGetUser.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as Awaited<ReturnType<typeof getUser>>);
    mockedInvite.mockResolvedValue(true);
  });

  it("401s when no session", async () => {
    mockedGetUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ pack: "sim_swap_credits_5pack" }));
    expect(res.status).toBe(401);
  });

  it("403s with invite_required when user has no redeemed invite", async () => {
    mockedInvite.mockResolvedValue(false);
    const res = await POST(makeRequest({ pack: "sim_swap_credits_5pack" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("invite_required");
  });

  it("400s on unknown pack value", async () => {
    const res = await POST(makeRequest({ pack: "totally_made_up" }));
    expect(res.status).toBe(400);
  });

  it("503s when the 5-pack price env var is unset", async () => {
    delete process.env.STRIPE_PRICE_SIM_SWAP_CREDITS_5PACK;
    const res = await POST(makeRequest({ pack: "sim_swap_credits_5pack" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("not_configured");
  });

  it("returns checkout URL when all gates pass", async () => {
    const res = await POST(makeRequest({ pack: "sim_swap_credits_5pack" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://checkout.stripe.com/test_session");
    expect(body.sku).toBe("sim_swap_credits_5pack");
  });
});

describe("POST /api/sim-swap/credits/checkout — feature flag off", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("503s when simSwapOnDemand is off (the bug PR 4 fixes)", async () => {
    vi.doMock("@askarthur/utils/feature-flags", () => ({
      featureFlags: { simSwapOnDemand: false },
    }));
    const { POST: gatedPost } = await import(
      "@/app/api/sim-swap/credits/checkout/route"
    );
    const req = new NextRequest("http://test/api/sim-swap/credits/checkout", {
      method: "POST",
      body: JSON.stringify({ pack: "sim_swap_credits_5pack" }),
      headers: { "content-type": "application/json" },
    });
    const res = await gatedPost(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("feature_disabled");
    vi.doUnmock("@askarthur/utils/feature-flags");
  });
});
