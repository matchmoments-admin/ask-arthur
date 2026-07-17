import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { webcrypto } from "node:crypto";

// Contract test: the dev client's signature MUST be accepted by the real
// server verifier. These are two independent implementations of one
// canonical string (scripts/extension-dev-client.ts vs
// _lib/signature.ts, itself mirroring apps/extension/src/lib/sign.ts) — if
// they drift, every local test session dies on an opaque 401 and the
// runbook (docs/ops/image-check-local-testing.md) is worthless. So we sign
// with the script and verify with the server, unmocked crypto both sides.

const mockKey = vi.hoisted(() => ({ jwk: null as JsonWebKey | null }));

const maybeSingle = vi.fn(async () => ({
  data: mockKey.jwk ? { public_key_jwk: mockKey.jwk, revoked: false } : null,
  error: null,
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      update: vi.fn(() => ({ eq: vi.fn() })),
    })),
  })),
}));

// In-memory Redis shim (nonce replay + pubkey cache), mirroring the shape
// used by extension-signature.test.ts.
vi.mock("@upstash/redis", () => {
  const store = new Map<string, unknown>();
  return {
    Redis: class {
      async get(k: string) {
        return store.get(k) ?? null;
      }
      async set(k: string, v: unknown, opts?: { nx?: boolean }) {
        if (opts?.nx && store.has(k)) return null;
        store.set(k, v);
        return "OK";
      }
      async del(k: string) {
        store.delete(k);
        return 1;
      }
    },
  };
});
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

process.env.UPSTASH_REDIS_REST_URL = "https://test-redis";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

const { verifyExtensionSignature } = await import(
  "@/app/api/extension/_lib/signature"
);
const { signHeaders } = await import("../scripts/extension-dev-client");

async function makeIdentity() {
  const kp = (await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const identity = {
    installId: webcrypto.randomUUID(),
    privateKeyJwk: await webcrypto.subtle.exportKey("jwk", kp.privateKey),
    publicKeyJwk: await webcrypto.subtle.exportKey("jwk", kp.publicKey),
  };
  mockKey.jwk = identity.publicKeyJwk;
  return identity;
}

describe("extension dev client ↔ server signature contract", () => {
  it("a POST signed by the dev client verifies server-side", async () => {
    const identity = await makeIdentity();
    const body = JSON.stringify({ imageUrl: "https://example.com/a.jpg" });
    const headers = await signHeaders(
      identity,
      "POST",
      "/api/extension/analyze-image",
      body,
    );

    const req = new NextRequest("http://localhost/api/extension/analyze-image", {
      method: "POST",
      body,
      headers,
    });
    const result = await verifyExtensionSignature(req);
    expect(result).toMatchObject({ ok: true, installId: identity.installId });
  });

  it("a GET signed by the dev client verifies server-side (empty body)", async () => {
    const identity = await makeIdentity();
    const headers = await signHeaders(
      identity,
      "GET",
      "/api/extension/subscription",
      "",
    );
    const req = new NextRequest("http://localhost/api/extension/subscription", {
      method: "GET",
      headers,
    });
    const result = await verifyExtensionSignature(req);
    expect(result).toMatchObject({ ok: true });
  });

  it("signing the wrong path is rejected (guards the pathname-only rule)", async () => {
    const identity = await makeIdentity();
    const body = "{}";
    // Sign the path WITH a query string — the server signs pathname only, so
    // this must fail. This is the mistake the script's comment warns about.
    const headers = await signHeaders(
      identity,
      "POST",
      "/api/extension/analyze-image?foo=bar",
      body,
    );
    const req = new NextRequest("http://localhost/api/extension/analyze-image", {
      method: "POST",
      body,
      headers,
    });
    const result = await verifyExtensionSignature(req);
    expect(result.ok).toBe(false);
  });

  it("a tampered body is rejected", async () => {
    const identity = await makeIdentity();
    const headers = await signHeaders(
      identity,
      "POST",
      "/api/extension/analyze-image",
      JSON.stringify({ imageUrl: "https://example.com/a.jpg" }),
    );
    const req = new NextRequest("http://localhost/api/extension/analyze-image", {
      method: "POST",
      body: JSON.stringify({ imageUrl: "https://evil.example.com/b.jpg" }),
      headers,
    });
    const result = await verifyExtensionSignature(req);
    expect(result.ok).toBe(false);
  });
});
