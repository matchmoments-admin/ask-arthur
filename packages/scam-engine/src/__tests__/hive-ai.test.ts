import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// checkHiveAI v2: full class-list retention + versioned cache prefix.
// First dedicated test for this module — fixtures model Hive's
// data.status[0].response.output[].classes shape.

const redisMock = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(function Redis() {
    return redisMock;
  }),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { checkHiveAI } from "../hive-ai";

const HIVE_FIXTURE = {
  data: {
    status: [
      {
        response: {
          output: [
            {
              classes: [
                { class: "ai_generated", score: 0.97 },
                { class: "not_ai_generated", score: 0.03 },
                { class: "deepfake", score: 0.12 },
                { class: "midjourney", score: 0.62 },
                { class: "dalle", score: 0.21 },
                { class: "flux", score: 0.08 },
                { class: "stablediffusion", score: 0.05 },
              ],
            },
          ],
        },
      },
    ],
  },
};

function stubFetch(json: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => json,
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.store.clear();
  redisMock.get.mockImplementation(async (k: string) => redisMock.store.get(k) ?? null);
  redisMock.set.mockImplementation(async (k: string, v: unknown) => {
    redisMock.store.set(k, v);
    return "OK";
  });
  process.env.HIVE_API_KEY = "test-key";
  process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HIVE_API_KEY;
});

describe("checkHiveAI", () => {
  it("retains the full class list alongside the derived signals", async () => {
    stubFetch(HIVE_FIXTURE);
    const result = await checkHiveAI("https://img.example.com/a.jpg");
    expect(result).not.toBeNull();
    expect(result!.isAiGenerated).toBe(true); // 0.97 >= 0.9
    expect(result!.aiConfidence).toBeCloseTo(0.97);
    expect(result!.isDeepfake).toBe(false); // 0.12 < 0.9
    expect(result!.generatorSource).toBe("midjourney"); // top non-verdict class
    expect(result!.classes).toHaveLength(7);
    expect(result!.classes).toContainEqual({ class: "flux", score: 0.08 });
  });

  it("caches under the v2 prefix (old-shape v1 entries are never read)", async () => {
    stubFetch(HIVE_FIXTURE);
    await checkHiveAI("https://img.example.com/a.jpg");
    const keys = [...redisMock.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^askarthur:hive:v2:/);
  });

  it("tolerates a cached result without the classes field (defensive read)", async () => {
    // Simulate a hand-poked / future-shape cache entry missing `classes` —
    // the reader must return it as-is without throwing.
    stubFetch(HIVE_FIXTURE);
    // Prime the cache key by computing it via one real call, then overwrite
    // with an old-shape object and call again.
    await checkHiveAI("https://img.example.com/b.jpg");
    const key = [...redisMock.store.keys()][0];
    redisMock.store.set(key, {
      isAiGenerated: true,
      aiConfidence: 0.95,
      isDeepfake: false,
      deepfakeConfidence: 0.1,
      generatorSource: "dalle",
    });
    const result = await checkHiveAI("https://img.example.com/b.jpg");
    expect(result!.generatorSource).toBe("dalle");
    expect(result!.classes).toBeUndefined();
  });

  it("returns null without an API key", async () => {
    delete process.env.HIVE_API_KEY;
    stubFetch(HIVE_FIXTURE);
    expect(await checkHiveAI("https://img.example.com/a.jpg")).toBeNull();
  });

  it("returns null on a malformed response shape", async () => {
    stubFetch({ data: { status: [{ response: {} }] } });
    expect(await checkHiveAI("https://img.example.com/c.jpg")).toBeNull();
  });
});
