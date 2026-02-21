import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("featureFlags", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("defaults all flags to false when env vars are not set", async () => {
    delete process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS;
    delete process.env.NEXT_PUBLIC_FF_DEEPFAKE;
    delete process.env.NEXT_PUBLIC_FF_PHONE_INTEL;
    delete process.env.NEXT_PUBLIC_FF_VIDEO_UPLOAD;

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.mediaAnalysis).toBe(false);
    expect(featureFlags.deepfakeDetection).toBe(false);
    expect(featureFlags.phoneIntelligence).toBe(false);
    expect(featureFlags.videoUpload).toBe(false);
  });

  it("enables mediaAnalysis when env var is true", async () => {
    process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS = "true";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.mediaAnalysis).toBe(true);
  });

  it('keeps mediaAnalysis false for non-"true" values', async () => {
    process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS = "1";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.mediaAnalysis).toBe(false);
  });

  it('enables deepfakeDetection when NEXT_PUBLIC_FF_DEEPFAKE is "true"', async () => {
    process.env.NEXT_PUBLIC_FF_DEEPFAKE = "true";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.deepfakeDetection).toBe(true);
  });

  it('keeps deepfakeDetection false for non-"true" values', async () => {
    process.env.NEXT_PUBLIC_FF_DEEPFAKE = "1";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.deepfakeDetection).toBe(false);
  });

  it("enables phoneIntelligence when env var is true", async () => {
    process.env.NEXT_PUBLIC_FF_PHONE_INTEL = "true";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.phoneIntelligence).toBe(true);
  });

  it("enables videoUpload when env var is true", async () => {
    process.env.NEXT_PUBLIC_FF_VIDEO_UPLOAD = "true";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.videoUpload).toBe(true);
  });
});
