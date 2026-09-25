import crypto from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createAdminToken, verifyAdminToken } from "@/lib/adminAuth";

beforeEach(() => {
  vi.stubEnv("ADMIN_SECRET", "test-admin-secret");
  vi.stubEnv("ADMIN_SESSION_EPOCH", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("admin session epoch", () => {
  it("a token minted under the current epoch verifies", () => {
    expect(verifyAdminToken(createAdminToken())).toBe(true);
  });

  it("bumping ADMIN_SESSION_EPOCH invalidates every outstanding token", () => {
    const token = createAdminToken();
    vi.stubEnv("ADMIN_SESSION_EPOCH", "1");
    expect(verifyAdminToken(token)).toBe(false);
    // …and tokens minted after the bump verify.
    expect(verifyAdminToken(createAdminToken())).toBe(true);
  });

  it("unset and \"0\" are the same epoch (no churn on deploy)", () => {
    const token = createAdminToken();
    vi.stubEnv("ADMIN_SESSION_EPOCH", "0");
    expect(verifyAdminToken(token)).toBe(true);
  });

  it("rejects the removed two-part timestamp:hmac format, even when correctly signed", () => {
    const ts = Date.now().toString();
    for (const key of ["test-admin-secret", "test-admin-secret:epoch:0"]) {
      const sig = crypto.createHmac("sha256", key).update(ts).digest("hex");
      expect(verifyAdminToken(`${ts}:${sig}`)).toBe(false);
    }
  });

  it("a token signed with the bare secret (pre-epoch key) no longer verifies", () => {
    const ts = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString("hex");
    const sig = crypto
      .createHmac("sha256", "test-admin-secret")
      .update(`${ts}:${nonce}`)
      .digest("hex");
    expect(verifyAdminToken(`${ts}:${nonce}:${sig}`)).toBe(false);
  });
});
