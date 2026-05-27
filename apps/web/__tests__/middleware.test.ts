/**
 * Middleware request-ID contract.
 *
 * Locks in three invariants introduced in the Axiom rollout PR 2:
 *
 * 1. Every response carries an `X-Request-Id` header.
 * 2. When the client sends a valid `Idempotency-Key`, it becomes the
 *    request id (Stripe-style retry-safety; matches the v73
 *    `scam_reports.idempotency_key` flow).
 * 3. When no Idempotency-Key is sent, the middleware generates a fresh
 *    ULID-shaped id (26-char Crockford-base32).
 *
 * The Axiom logger itself is exercised in `axiomLogger.test.ts` (not
 * yet built); the middleware test stays focused on the request-id
 * contract because that's the durable cross-system invariant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks (factories are hoisted) ──

// Vitest hoists `vi.mock` factories above all top-level imports, so we
// can't reference `NextResponse` from the file's import statement here.
// An async factory + `await import()` is the canonical Vitest pattern
// for accessing the real module inside a mock — works inside the hoist.
vi.mock("@askarthur/supabase/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return {
    createMiddlewareClient: vi.fn(() => ({
      supabase: null,
      response: NextResponse.next(),
    })),
  };
});

vi.mock("@/lib/adminAuth", () => ({
  verifyAdminToken: vi.fn(() => false),
  COOKIE_NAME: "aa_admin",
}));

vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Upstash off → middleware fail-opens (dev posture). Avoids needing a
// live Redis mock; the rate-limit path is exercised by a separate
// upstreamRateLimit.test.ts.
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.NEXT_PUBLIC_FF_AUTH;
});

async function callMiddleware(headers: Record<string, string> = {}) {
  const { middleware } = await import("../middleware");
  const req = new NextRequest("https://askarthur.au/api/analyze", {
    method: "POST",
    headers,
  });
  return middleware(req);
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe("middleware request-id propagation", () => {
  it("echoes a client-supplied Idempotency-Key as X-Request-Id", async () => {
    const res = await callMiddleware({ "Idempotency-Key": "client-key-abcdef-1234" });
    expect(res.headers.get("X-Request-Id")).toBe("client-key-abcdef-1234");
  });

  it("generates a fresh ULID when no Idempotency-Key is supplied", async () => {
    const res = await callMiddleware();
    const id = res.headers.get("X-Request-Id");
    expect(id).toBeTruthy();
    expect(id).toMatch(ULID_PATTERN);
  });

  it("rejects malformed idempotency keys and generates a fresh id", async () => {
    // `*` is outside the validation regex
    const res = await callMiddleware({ "Idempotency-Key": "bad*key" });
    const id = res.headers.get("X-Request-Id");
    expect(id).not.toBe("bad*key");
    expect(id).toMatch(ULID_PATTERN);
  });

  it("sets X-Request-Id on a GET to a non-API path too", async () => {
    const { middleware } = await import("../middleware");
    const req = new NextRequest("https://askarthur.au/blog/example", {
      method: "GET",
    });
    const res = await middleware(req);
    expect(res.headers.get("X-Request-Id")).toBeTruthy();
  });

  it("prefers Idempotency-Key over a client-supplied x-request-id (dedup intent wins)", async () => {
    // Hypothetical edge case: a misbehaving client sends BOTH headers
    // with different values. The Idempotency-Key carries explicit
    // dedup intent and must win — otherwise a client could bypass
    // their own idempotency contract by also sending x-request-id.
    const res = await callMiddleware({
      "Idempotency-Key": "idem-key-aaaaaa",
      "x-request-id": "xreqid-bbbbbb",
    });
    expect(res.headers.get("X-Request-Id")).toBe("idem-key-aaaaaa");
  });

  it("falls through to a client-supplied x-request-id when no Idempotency-Key is sent", async () => {
    const res = await callMiddleware({ "x-request-id": "client-trace-12345" });
    expect(res.headers.get("X-Request-Id")).toBe("client-trace-12345");
  });
});
