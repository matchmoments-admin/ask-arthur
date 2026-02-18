import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("whisper", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns mock transcript when OPENAI_API_KEY is not set in dev", async () => {
    delete process.env.OPENAI_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { transcribeAudio } = await import("@/lib/whisper");
    const result = await transcribeAudio(Buffer.from("fake-audio"), "test.mp3");

    expect(result.text).toContain("Australian Tax Office");
    expect(result.durationSeconds).toBe(42);
  });

  it("throws when file exceeds 25MB", async () => {
    delete process.env.OPENAI_API_KEY;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    const { transcribeAudio } = await import("@/lib/whisper");
    const hugeBuffer = Buffer.alloc(26 * 1024 * 1024);

    await expect(transcribeAudio(hugeBuffer, "huge.mp3")).rejects.toThrow("25MB");
  });
});

describe("mediaAnalysis pipeline", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("createMediaJob does not throw when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { createMediaJob } = await import("@/lib/mediaAnalysis");
    // Should gracefully no-op when Supabase returns null
    await expect(createMediaJob("test-id", "media/test.mp3", "audio")).resolves.not.toThrow();
  });

  it("getMediaJob returns null when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const { getMediaJob } = await import("@/lib/mediaAnalysis");
    const result = await getMediaJob("nonexistent-id");
    expect(result).toBeNull();
  });
});

describe("PII scrubbing on transcripts", () => {
  it("scrubs email addresses from transcript text", async () => {
    const { scrubPII } = await import("@/lib/scamPipeline");
    const transcript = "Please send your details to victim@gmail.com for the refund";
    const scrubbed = scrubPII(transcript);
    expect(scrubbed).toContain("[EMAIL]");
    expect(scrubbed).not.toContain("victim@gmail.com");
  });

  it("scrubs Australian phone numbers from transcript text", async () => {
    const { scrubPII } = await import("@/lib/scamPipeline");
    const transcript = "Call us back on 0412 345 678 to claim your prize";
    const scrubbed = scrubPII(transcript);
    expect(scrubbed).not.toContain("0412 345 678");
  });
});

describe("feature flag gating", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("mediaAnalysis flag defaults to false", async () => {
    delete process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS;

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.mediaAnalysis).toBe(false);
  });

  it('mediaAnalysis flag is true when env is "true"', async () => {
    process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS = "true";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.mediaAnalysis).toBe(true);
  });

  it('mediaAnalysis flag is false for non-"true" values', async () => {
    process.env.NEXT_PUBLIC_FF_MEDIA_ANALYSIS = "1";

    const { featureFlags } = await import("@/lib/featureFlags");
    expect(featureFlags.mediaAnalysis).toBe(false);
  });
});

describe("r2 audio type validation", () => {
  it("accepts standard audio MIME types", async () => {
    const { isAcceptedAudioType } = await import("@/lib/r2");
    expect(isAcceptedAudioType("audio/mpeg")).toBe(true);
    expect(isAcceptedAudioType("audio/mp3")).toBe(true);
    expect(isAcceptedAudioType("audio/wav")).toBe(true);
    expect(isAcceptedAudioType("audio/webm")).toBe(true);
    expect(isAcceptedAudioType("audio/ogg")).toBe(true);
    expect(isAcceptedAudioType("audio/flac")).toBe(true);
    expect(isAcceptedAudioType("audio/m4a")).toBe(true);
    expect(isAcceptedAudioType("audio/mp4")).toBe(true);
  });

  it("rejects non-audio MIME types", async () => {
    const { isAcceptedAudioType } = await import("@/lib/r2");
    expect(isAcceptedAudioType("video/mp4")).toBe(false);
    expect(isAcceptedAudioType("image/png")).toBe(false);
    expect(isAcceptedAudioType("text/plain")).toBe(false);
    expect(isAcceptedAudioType("application/json")).toBe(false);
  });
});
