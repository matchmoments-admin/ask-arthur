import { describe, it, expect, beforeEach, vi } from "vitest";

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

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/sim-swap/invites/redeem/route";
import { getUser } from "@/lib/auth";
import { createServiceClient } from "@askarthur/supabase/server";

const mockedGetUser = vi.mocked(getUser);
const mockedSupa = vi.mocked(createServiceClient);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://test/api/sim-swap/invites/redeem", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

interface FakeInvite {
  invite_code: string;
  redeemed_by: string | null;
  redeemed_at: string | null;
}

function supaWith(invite: FakeInvite | null, updateError: unknown = null) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: invite, error: null }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockResolvedValue({ error: updateError }),
      }),
    }),
  };
  return { from: vi.fn(() => builder) } as unknown as ReturnType<
    typeof createServiceClient
  >;
}

describe("POST /api/sim-swap/invites/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetUser.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as Awaited<ReturnType<typeof getUser>>);
  });

  it("401s when no session", async () => {
    mockedGetUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ inviteCode: "abc" }));
    expect(res.status).toBe(401);
  });

  it("400s on invalid body", async () => {
    const res = await POST(makeRequest({ wrongField: "value" }));
    expect(res.status).toBe(400);
  });

  it("404s when the invite code doesn't exist", async () => {
    mockedSupa.mockReturnValue(supaWith(null));
    const res = await POST(makeRequest({ inviteCode: "missing-code" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("invite_not_found");
  });

  it("idempotent — same user re-redeeming returns ok with alreadyRedeemed", async () => {
    mockedSupa.mockReturnValue(
      supaWith({
        invite_code: "code",
        redeemed_by: "user-1",
        redeemed_at: "2026-05-15T00:00:00Z",
      }),
    );
    const res = await POST(makeRequest({ inviteCode: "code" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, alreadyRedeemed: true });
  });

  it("410s when invite is held by a different user", async () => {
    mockedSupa.mockReturnValue(
      supaWith({
        invite_code: "code",
        redeemed_by: "user-2",
        redeemed_at: "2026-05-15T00:00:00Z",
      }),
    );
    const res = await POST(makeRequest({ inviteCode: "code" }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("invite_already_used");
  });

  it("200s + writes redemption on first redeem", async () => {
    mockedSupa.mockReturnValue(
      supaWith({
        invite_code: "code",
        redeemed_by: null,
        redeemed_at: null,
      }),
    );
    const res = await POST(makeRequest({ inviteCode: "code" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });
});

describe("POST /api/sim-swap/invites/redeem — feature flag off", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("503s when simSwapOnDemand is off", async () => {
    vi.doMock("@askarthur/utils/feature-flags", () => ({
      featureFlags: { simSwapOnDemand: false },
    }));
    const { POST: gatedPost } = await import(
      "@/app/api/sim-swap/invites/redeem/route"
    );

    const res = await gatedPost(makeRequest({ inviteCode: "code" }));
    expect(res.status).toBe(503);

    vi.doUnmock("@askarthur/utils/feature-flags");
  });
});
