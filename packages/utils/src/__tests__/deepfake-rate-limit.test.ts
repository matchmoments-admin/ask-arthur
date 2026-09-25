import { afterEach, describe, expect, it, vi } from "vitest";
import { checkDeepfakeRateLimit } from "../rate-limit";

afterEach(() => vi.unstubAllEnvs());

describe("checkDeepfakeRateLimit", () => {
  it("fails closed in production when the store is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const r = await checkDeepfakeRateLimit("1.2.3.4");
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("store_unavailable");
  });

  it("fails open outside production", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect((await checkDeepfakeRateLimit("1.2.3.4")).allowed).toBe(true);
  });
});
