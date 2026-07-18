import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// checkHiveAI v3: migrated to Hive's V3 API (Bearer auth, JSON body,
// flat output[0].classes with a `value` score field). Full class-list
// retention + versioned cache prefix are preserved from v2.

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

// V3 response shape: flat `output[0].classes`, score field is `value`.
const HIVE_FIXTURE = {
  task_id: "task-abc",
  model: "ai-generated-and-deepfake-content-detection",
  output: [
    {
      classes: [
        { class: "ai_generated", value: 0.97 },
        { class: "not_ai_generated", value: 0.03 },
        { class: "deepfake", value: 0.12 },
        { class: "midjourney", value: 0.62 },
        { class: "dalle", value: 0.21 },
        { class: "flux", value: 0.08 },
        { class: "stablediffusion", value: 0.05 },
        // Audio head — present even for image-only inputs. These must NOT be
        // treated as a generator source, even though not_ai_generated_audio
        // (0.99) outscores the real generator (midjourney 0.62).
        { class: "not_ai_generated_audio", value: 0.99 },
        { class: "ai_generated_audio", value: 0.01 },
      ],
    },
  ],
};

// A real photo: generation head says not-AI; the audio + sentinel classes
// score high; no genuine generator scores meaningfully. generatorSource must
// be null (the live 2026-07-18 bug: it reported "not_ai_generated_audio").
const REAL_PHOTO_FIXTURE = {
  task_id: "task-real",
  model: "ai-generated-and-deepfake-content-detection",
  output: [
    {
      classes: [
        { class: "not_ai_generated", value: 0.9999 },
        { class: "ai_generated", value: 0.0001 },
        { class: "deepfake", value: 0.0001 },
        { class: "not_ai_generated_audio", value: 0.9998 },
        { class: "ai_generated_audio", value: 0.0002 },
        { class: "none", value: 0.9997 },
        { class: "midjourney", value: 0.0000001 },
        { class: "stablediffusion", value: 0.0000002 },
      ],
    },
  ],
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
    // midjourney (0.62) wins — the audio classes are excluded even though
    // not_ai_generated_audio (0.99) scores higher.
    expect(result!.generatorSource).toBe("midjourney");
    expect(result!.classes).toHaveLength(9);
    expect(result!.classes).toContainEqual({ class: "flux", score: 0.08 });
  });

  it("returns null generatorSource for a real photo (no spurious generator/audio class)", async () => {
    stubFetch(REAL_PHOTO_FIXTURE);
    const result = await checkHiveAI("https://img.example.com/real.jpg");
    expect(result).not.toBeNull();
    expect(result!.isAiGenerated).toBe(false); // 0.0001 < 0.9
    expect(result!.isDeepfake).toBe(false);
    // The bug: this used to be "not_ai_generated_audio". A real photo has no
    // generator, so it must be null on both counts (audio excluded AND the
    // not-AI gate).
    expect(result!.generatorSource).toBeNull();
    // Full class list still retained for the breakdown UI.
    expect(result!.classes).toHaveLength(8);
  });

  it("caches under the v3 prefix (old-shape v2 entries are never read)", async () => {
    stubFetch(HIVE_FIXTURE);
    await checkHiveAI("https://img.example.com/a.jpg");
    const keys = [...redisMock.store.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^askarthur:hive:v3:/);
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
    // V3 flat shape missing output[0].classes.
    stubFetch({ task_id: "task-x", output: [{}] });
    expect(await checkHiveAI("https://img.example.com/c.jpg")).toBeNull();
  });
});
