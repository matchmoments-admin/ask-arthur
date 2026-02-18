import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the provider modules before importing
vi.mock("@/lib/realityDefender", () => ({
  detectDeepfakeRD: vi.fn(),
}));

vi.mock("@/lib/resembleDetect", () => ({
  detectDeepfakeResemble: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { detectDeepfake } from "@/lib/deepfakeDetection";
import { detectDeepfakeRD } from "@/lib/realityDefender";
import { detectDeepfakeResemble } from "@/lib/resembleDetect";

describe("detectDeepfake", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses Reality Defender when API key is set", async () => {
    process.env.REALITY_DEFENDER_API_KEY = "test-key";

    const mockResult = {
      isLikelyDeepfake: false,
      score: 0.15,
      provider: "reality_defender" as const,
      status: "complete",
      raw: {},
    };
    vi.mocked(detectDeepfakeRD).mockResolvedValue(mockResult);

    const result = await detectDeepfake("/tmp/test.mp3", "https://example.com/test.mp3");
    expect(result).toEqual(mockResult);
    expect(detectDeepfakeRD).toHaveBeenCalledWith("/tmp/test.mp3");
    expect(detectDeepfakeResemble).not.toHaveBeenCalled();
  });

  it("falls back to Resemble AI when Reality Defender fails", async () => {
    process.env.REALITY_DEFENDER_API_KEY = "test-key";
    process.env.RESEMBLE_AI_API_TOKEN = "test-token";

    vi.mocked(detectDeepfakeRD).mockRejectedValue(new Error("RD timeout"));
    vi.mocked(detectDeepfakeResemble).mockResolvedValue({
      isLikelyDeepfake: true,
      score: 0.85,
      label: "fake",
      provider: "resemble_ai",
      raw: {},
    });

    const result = await detectDeepfake("/tmp/test.mp3", "https://example.com/test.mp3");
    expect(result.provider).toBe("resemble_ai");
    expect(result.score).toBe(0.85);
    expect(detectDeepfakeRD).toHaveBeenCalled();
    expect(detectDeepfakeResemble).toHaveBeenCalledWith("https://example.com/test.mp3");
  });

  it("uses Resemble AI directly when no Reality Defender key", async () => {
    delete process.env.REALITY_DEFENDER_API_KEY;
    process.env.RESEMBLE_AI_API_TOKEN = "test-token";

    vi.mocked(detectDeepfakeResemble).mockResolvedValue({
      isLikelyDeepfake: false,
      score: 0.2,
      label: "real",
      provider: "resemble_ai",
      raw: {},
    });

    const result = await detectDeepfake("/tmp/test.mp3", "https://example.com/test.mp3");
    expect(result.provider).toBe("resemble_ai");
    expect(detectDeepfakeRD).not.toHaveBeenCalled();
  });

  it("throws when no provider is configured", async () => {
    delete process.env.REALITY_DEFENDER_API_KEY;
    delete process.env.RESEMBLE_AI_API_TOKEN;

    await expect(
      detectDeepfake("/tmp/test.mp3", "https://example.com/test.mp3")
    ).rejects.toThrow("No deepfake detection provider configured");
  });

  it("throws when both providers fail", async () => {
    process.env.REALITY_DEFENDER_API_KEY = "test-key";
    process.env.RESEMBLE_AI_API_TOKEN = "test-token";

    vi.mocked(detectDeepfakeRD).mockRejectedValue(new Error("RD failed"));
    vi.mocked(detectDeepfakeResemble).mockRejectedValue(new Error("Resemble failed"));

    await expect(
      detectDeepfake("/tmp/test.mp3", "https://example.com/test.mp3")
    ).rejects.toThrow("Resemble failed");
  });
});
