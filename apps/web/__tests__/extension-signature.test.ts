import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mocks ──

let mockKeyJwk: JsonWebKey | null = null;
let mockRevoked = false;

const maybeSingle = vi.fn(async () => ({
  data: mockKeyJwk
    ? { public_key_jwk: mockKeyJwk, revoked: mockRevoked }
    : null,
  error: null,
}));
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select, update: vi.fn(() => ({ eq: vi.fn() })) }));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({ from })),
}));

// Nonce replay store + public-key cache — simple in-memory Redis shim.
// Declared via vi.hoisted so the module-level mock factory can see it despite
// vi.mock's hoisting semantics.
const { redisStore, RedisMock } = vi.hoisted(() => {
  const store = new Map<string, { value: unknown; exp: number | null }>();
  class R {
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.exp && entry.exp < Date.now()) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }
    async set(
      key: string,
      value: unknown,
      opts?: { ex?: number; nx?: boolean }
    ) {
      if (opts?.nx && store.has(key)) {
        const entry = store.get(key)!;
        if (!entry.exp || entry.exp > Date.now()) return null;
      }
      store.set(key, {
        value,
        exp: opts?.ex ? Date.now() + opts.ex * 1000 : null,
      });
      return "OK";
    }
    async del(key: string) {
      store.delete(key);
      return 1;
    }
  }
  return { redisStore: store, RedisMock: R };
});

vi.mock("@upstash/redis", () => ({
  Redis: RedisMock,
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow() {
      return null;
    }
    async limit() {
      return { success: true, remaining: 100, reset: Date.now() + 60_000 };
    }
  },
}));

vi.mock("@askarthur/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Env
process.env.UPSTASH_REDIS_REST_URL = "https://test-redis";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

const { verifyExtensionSignature } = await import(
  "@/app/api/extension/_lib/signature"
);
const { validateExtensionRequest } = await import(
  "@/app/api/extension/_lib/auth"
);

// ── Helpers ──

const INSTALL_ID = "11111111-2222-3333-4444-555555555555";

async function makeKeypair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

async function sha256Base64(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s)
  );
  return bytesToBase64(new Uint8Array(buf));
}

async function buildSignedRequest(opts: {
  method?: string;
  path?: string;
  body?: string;
  privateKey: CryptoKey;
  installId?: string;
  timestamp?: number;
  nonce?: string;
  tamperBody?: boolean;
}): Promise<NextRequest> {
  const method = opts.method ?? "POST";
  const path = opts.path ?? "/api/extension/analyze";
  const body = opts.body ?? JSON.stringify({ text: "hello" });
  const installId = opts.installId ?? INSTALL_ID;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? crypto.randomUUID();

  const hashBody = opts.tamperBody ? body + "X" : body;
  const bodyHash = await sha256Base64(hashBody);
  const canonical = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    opts.privateKey,
    new TextEncoder().encode(canonical)
  );

  return new NextRequest(`http://localhost${path}`, {
    method,
    body: method === "GET" ? undefined : body,
    headers: {
      "x-extension-install-id": installId,
      "x-extension-timestamp": String(timestamp),
      "x-extension-nonce": nonce,
      "x-extension-signature": bytesToBase64(new Uint8Array(sig)),
      "content-type": "application/json",
    },
  });
}

beforeEach(() => {
  redisStore.clear();
  mockRevoked = false;
});

// ── Tests ──

describe("verifyExtensionSignature", () => {
  it("accepts a valid signature round-trip", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const req = await buildSignedRequest({ privateKey: pair.privateKey });
    const result = await verifyExtensionSignature(req);
    expect(result).toEqual({ ok: true, installId: INSTALL_ID });
  });

  it("rejects stale timestamps (outside 5-min skew)", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const tenMinAgo = Math.floor(Date.now() / 1000) - 600;
    const req = await buildSignedRequest({
      privateKey: pair.privateKey,
      timestamp: tenMinAgo,
    });
    const result = await verifyExtensionSignature(req);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/skew/i);
      expect(result.status).toBe(401);
    }
  });

  it("rejects replayed nonces", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const nonce = crypto.randomUUID();
    const first = await buildSignedRequest({
      privateKey: pair.privateKey,
      nonce,
    });
    expect((await verifyExtensionSignature(first)).ok).toBe(true);

    const replay = await buildSignedRequest({
      privateKey: pair.privateKey,
      nonce,
    });
    const result = await verifyExtensionSignature(replay);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/replay/i);
  });

  it("rejects tampered bodies", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const req = await buildSignedRequest({
      privateKey: pair.privateKey,
      tamperBody: true,
    });
    const result = await verifyExtensionSignature(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects signatures from an unknown install id", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = null; // Supabase returns nothing
    const req = await buildSignedRequest({ privateKey: pair.privateKey });
    const result = await verifyExtensionSignature(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unknown/i);
  });

  it("rejects revoked install ids", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    mockRevoked = true;
    const req = await buildSignedRequest({ privateKey: pair.privateKey });
    const result = await verifyExtensionSignature(req);
    expect(result.ok).toBe(false);
  });
});

describe("validateExtensionRequest", () => {
  it("accepts a valid signature", async () => {
    const pair = await makeKeypair();
    mockKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const req = await buildSignedRequest({ privateKey: pair.privateKey });
    const result = await validateExtensionRequest(req);
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.installId).toBe(INSTALL_ID);
  });

  it("rejects a request with no signature headers", async () => {
    const req = new NextRequest("http://localhost/api/extension/analyze", {
      method: "POST",
      body: JSON.stringify({ text: "hi" }),
      headers: { "content-type": "application/json" },
    });
    const result = await validateExtensionRequest(req);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.status).toBe(401);
  });
});
