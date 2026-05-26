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

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.mediaAnalysis).toBe(false);
    expect(featureFlags.deepfakeDetection).toBe(false);
    expect(featureFlags.phoneIntelligence).toBe(false);
    expect(featureFlags.videoUpload).toBe(false);
  });

  it("enables mediaAnalysis when env var is true", async () => {
    process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS = "true";

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.mediaAnalysis).toBe(true);
  });

  it('keeps mediaAnalysis false for non-"true" values', async () => {
    process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS = "1";

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.mediaAnalysis).toBe(false);
  });

  it('enables deepfakeDetection when NEXT_PUBLIC_FF_DEEPFAKE is "true"', async () => {
    process.env.NEXT_PUBLIC_FF_DEEPFAKE = "true";

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.deepfakeDetection).toBe(true);
  });

  it('keeps deepfakeDetection false for non-"true" values', async () => {
    process.env.NEXT_PUBLIC_FF_DEEPFAKE = "1";

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.deepfakeDetection).toBe(false);
  });

  it("enables phoneIntelligence when env var is true", async () => {
    process.env.NEXT_PUBLIC_FF_PHONE_INTEL = "true";

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.phoneIntelligence).toBe(true);
  });

  it("enables videoUpload when env var is true", async () => {
    process.env.NEXT_PUBLIC_FF_VIDEO_UPLOAD = "true";

    const { featureFlags } = await import("@askarthur/utils/feature-flags");
    expect(featureFlags.videoUpload).toBe(true);
  });

  // Server-side flags route through readBoolEnv(), which trims whitespace
  // and uses bracket notation. The trim defends against the 2026-05-26
  // incident where two Vercel env vars were stored as "true\n" (trailing
  // newline) and silently evaluated to false; the bracket notation
  // defends against Next.js DefinePlugin inlining process.env.X reads at
  // build time for vars not visible to the build process.
  describe("readBoolEnv whitespace tolerance (server-side flags)", () => {
    it("treats 'true\\n' (trailing newline) as true", async () => {
      process.env.FF_SHOPFRONT_CLONE_URLSCAN = "true\n";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.shopfrontCloneUrlscan).toBe(true);
    });

    it("treats 'true ' (trailing space) as true", async () => {
      process.env.FF_SHOPFRONT_CLONE_OUTREACH = "true ";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.shopfrontCloneOutreach).toBe(true);
    });

    it("treats ' true' (leading space) as true", async () => {
      process.env.FF_SHOP_SIGNAL = " true";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.shopSignal).toBe(true);
    });

    it("treats 'true\\r\\n' (Windows newline) as true", async () => {
      process.env.FF_REDDIT_INTEL_INGEST = "true\r\n";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.redditIntelIngest).toBe(true);
    });

    it("treats 'True' (wrong case) as false (strict 'true' only)", async () => {
      process.env.FF_RAG_THEMES = "True";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.ragThemes).toBe(false);
    });

    it("treats undefined as false", async () => {
      delete process.env.FF_VONAGE_ENABLED;

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.vonageEnabled).toBe(false);
    });

    it("treats empty string as false", async () => {
      process.env.FF_LEAKCHECK_ENABLED = "";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.leakcheckEnabled).toBe(false);
    });

    it("treats whitespace-only as false", async () => {
      process.env.FF_TWILIO_VERIFY_ENABLED = "   \n  ";

      const { featureFlags } = await import("@askarthur/utils/feature-flags");
      expect(featureFlags.twilioVerifyEnabled).toBe(false);
    });
  });
});
