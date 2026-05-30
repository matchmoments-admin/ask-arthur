import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Upstash client so isReplay's SET NX is observable.
const setMock = vi.fn();
vi.mock("@upstash/redis", () => ({
  Redis: class {
    set = setMock;
  },
}));

// getRedis() needs both env vars to instantiate a client.
process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";

import { isReplay } from "@/lib/bots/replay-dedup";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isReplay", () => {
  it("returns false (process) and records the id on first sight", async () => {
    setMock.mockResolvedValueOnce("OK"); // NX succeeded → newly set
    const replay = await isReplay("telegram", 12345);
    expect(replay).toBe(false);
    expect(setMock).toHaveBeenCalledWith(
      "botdedup:telegram:12345",
      "1",
      expect.objectContaining({ nx: true }),
    );
  });

  it("returns true (suppress) when the id already exists", async () => {
    setMock.mockResolvedValueOnce(null); // NX no-op → key already present
    const replay = await isReplay("messenger", "mid.abc");
    expect(replay).toBe(true);
  });

  it("fails OPEN (returns false) on a Redis error", async () => {
    setMock.mockRejectedValueOnce(new Error("redis down"));
    const replay = await isReplay("whatsapp", "wamid.xyz");
    expect(replay).toBe(false);
  });

  it("treats a missing id as non-replay without touching Redis", async () => {
    const replay = await isReplay("telegram", undefined);
    expect(replay).toBe(false);
    expect(setMock).not.toHaveBeenCalled();
  });
});
