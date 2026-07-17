import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Install↔account link flow: /api/extension/link-token (extension-signed
// mint) + /api/extension/link (session-authed consume). Security properties
// under test: only a validly-signed install can mint; tokens are single-use
// and expire; an install linked to a different user is a 409, never a
// silent re-link.

const redisStore = new Map<string, string>();
const redisMock = {
  set: vi.fn(async (key: string, value: string) => {
    redisStore.set(key, value);
    return "OK";
  }),
  getdel: vi.fn(async (key: string) => {
    const v = redisStore.get(key) ?? null;
    redisStore.delete(key);
    return v;
  }),
};

vi.mock("@upstash/redis", () => ({
  // Regular function (not arrow) so `new Redis(...)` works.
  Redis: vi.fn(function Redis() {
    return redisMock;
  }),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { extensionBilling: true },
}));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(),
}));
vi.mock("@/lib/auth", () => {
  class AuthUnavailableError extends Error {}
  return {
    AuthUnavailableError,
    getUser: vi.fn(),
  };
});

const supabaseState: {
  install: { install_id: string; revoked: boolean } | null;
  existing: { user_id: string | null; tier: string } | null;
  upserts: Array<Record<string, unknown>>;
} = { install: null, existing: null, upserts: [] };

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "extension_installs") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: supabaseState.install, error: null })),
        };
      }
      if (table === "extension_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: supabaseState.existing, error: null })),
          upsert: vi.fn(async (row: Record<string, unknown>) => {
            supabaseState.upserts.push(row);
            return { error: null };
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

import { POST as mintPOST } from "@/app/api/extension/link-token/route";
import { POST as linkPOST } from "@/app/api/extension/link/route";
import { validateExtensionRequest } from "@/app/api/extension/_lib/auth";
import { getUser } from "@/lib/auth";
import { featureFlags } from "@askarthur/utils/feature-flags";

function mintReq() {
  return new NextRequest("http://localhost/api/extension/link-token", {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });
}

function linkReq(token: string) {
  return new NextRequest("http://localhost/api/extension/link", {
    method: "POST",
    body: JSON.stringify({ token }),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  redisStore.clear();
  supabaseState.install = { install_id: "install-a", revoked: false };
  supabaseState.existing = null;
  supabaseState.upserts = [];
  (featureFlags as { extensionBilling: boolean }).extensionBilling = true;
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  vi.mocked(validateExtensionRequest).mockResolvedValue({
    valid: true,
    installId: "install-a",
    remaining: 42,
    requestId: null,
    tier: "free",
  });
  vi.mocked(getUser).mockResolvedValue({ id: "user-1", email: "u@example.com" } as never);
});

async function mintToken(): Promise<string> {
  const res = await mintPOST(mintReq());
  expect(res.status).toBe(200);
  const { token } = await res.json();
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  return token;
}

describe("link-token mint", () => {
  it("503s when the billing flag is off", async () => {
    (featureFlags as { extensionBilling: boolean }).extensionBilling = false;
    const res = await mintPOST(mintReq());
    expect(res.status).toBe(503);
  });

  it("requires a valid extension signature", async () => {
    vi.mocked(validateExtensionRequest).mockResolvedValue({
      valid: false,
      error: "invalid_signature",
      status: 401,
    });
    const res = await mintPOST(mintReq());
    expect(res.status).toBe(401);
    expect(redisStore.size).toBe(0);
  });

  it("mints a 64-hex token bound to the signed install", async () => {
    const token = await mintToken();
    expect(redisStore.get(`askarthur:ext:link:${token}`)).toBe("install-a");
  });
});

describe("link consume", () => {
  it("requires a web session", async () => {
    vi.mocked(getUser).mockResolvedValue(null);
    const res = await linkPOST(linkReq("a".repeat(64)));
    expect(res.status).toBe(401);
  });

  it("links the install to the logged-in user and is single-use", async () => {
    const token = await mintToken();

    const res = await linkPOST(linkReq(token));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.linked).toBe(true);
    expect(supabaseState.upserts[0]).toMatchObject({
      install_id: "install-a",
      user_id: "user-1",
    });

    // Replay: token was GETDEL'd — second consume fails.
    const replay = await linkPOST(linkReq(token));
    expect(replay.status).toBe(401);
    expect((await replay.json()).error).toBe("invalid_or_expired_token");
  });

  it("rejects unknown/expired tokens", async () => {
    const res = await linkPOST(linkReq("b".repeat(64)));
    expect(res.status).toBe(401);
  });

  it("409s when the install is already linked to a different user", async () => {
    supabaseState.existing = { user_id: "user-2", tier: "pro" };
    const token = await mintToken();
    const res = await linkPOST(linkReq(token));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_linked");
    expect(supabaseState.upserts).toHaveLength(0);
  });

  it("re-linking the SAME user succeeds (idempotent)", async () => {
    supabaseState.existing = { user_id: "user-1", tier: "pro" };
    const token = await mintToken();
    const res = await linkPOST(linkReq(token));
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe("pro");
  });

  it("404s for a revoked install", async () => {
    supabaseState.install = { install_id: "install-a", revoked: true };
    const token = await mintToken();
    const res = await linkPOST(linkReq(token));
    expect(res.status).toBe(404);
  });
});
