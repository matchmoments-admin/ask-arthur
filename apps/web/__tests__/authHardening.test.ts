/**
 * PR-AUTH-HARDEN regression — five protected routes / six callsites that
 * previously did bare `authClient.auth.getUser()` and would 504 on any
 * Supabase Auth degradation (5s middleware budget, then Vercel kills the
 * request at 25s with MIDDLEWARE_INVOCATION_TIMEOUT — same incident shape
 * as 2026-05-09).
 *
 * Post-PR every route calls `getSupabaseUserOrThrow(authClient)` from
 * `apps/web/lib/auth.ts`, catches `AuthUnavailableError`, and returns
 * 503 + Retry-After. The pattern matches /api/keys/route.ts (already
 * wrapped earlier).
 *
 * These tests assert the degraded-Auth contract is uniform across all
 * six callsites — no route accidentally swallows the error or returns
 * 504 / 401 / 500 instead of 503.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks (factories are hoisted) ──

vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { familyPlan: true },
}));

vi.mock("@askarthur/supabase/server-auth", () => ({
  createAuthServerClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(), signOut: vi.fn() },
  })),
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/auth", async () => {
  // Local copy of AuthUnavailableError so `instanceof` checks in the routes
  // pass without pulling the real module (which is `server-only`).
  class AuthUnavailableError extends Error {
    constructor() {
      super("Supabase Auth is unavailable");
      this.name = "AuthUnavailableError";
    }
  }
  return {
    AuthUnavailableError,
    getSupabaseUserOrThrow: vi.fn(async () => {
      throw new AuthUnavailableError();
    }),
  };
});

// Import routes AFTER mocks
const { GET: familyGet, POST: familyPost } = await import(
  "@/app/api/family/route"
);
const { POST: invitePost } = await import("@/app/api/family/invite/route");
const { POST: joinPost } = await import("@/app/api/family/join/route");
const { POST: deletePost } = await import(
  "@/app/api/user/delete-account/route"
);
const { GET: exportGet } = await import("@/app/api/user/export-data/route");

function mockReq() {
  return new NextRequest("http://localhost:3000/test", { method: "POST" });
}

async function expect503(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get("Retry-After")).toBe("30");
  const body = await res.json();
  expect(body.error).toBe("auth_unavailable");
}

describe("PR-AUTH-HARDEN — degraded-Auth fallback contract", () => {
  it("GET /api/family returns 503 + Retry-After when auth times out", async () => {
    const res = await familyGet(mockReq());
    await expect503(res);
  });

  it("POST /api/family returns 503 + Retry-After when auth times out", async () => {
    const res = await familyPost(mockReq());
    await expect503(res);
  });

  it("POST /api/family/invite returns 503 + Retry-After when auth times out", async () => {
    const res = await invitePost(mockReq());
    await expect503(res);
  });

  it("POST /api/family/join returns 503 + Retry-After when auth times out", async () => {
    const res = await joinPost(mockReq());
    await expect503(res);
  });

  it("POST /api/user/delete-account returns 503 + Retry-After when auth times out", async () => {
    const res = await deletePost(mockReq());
    await expect503(res);
  });

  it("GET /api/user/export-data returns 503 + Retry-After when auth times out", async () => {
    const res = await exportGet();
    await expect503(res);
  });
});
