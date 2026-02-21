import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSend = vi.fn().mockResolvedValue({});

describe("uploadScreenshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Clean env before each test
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCESS_KEY_ID;
    delete process.env.R2_SECRET_ACCESS_KEY;
  });

  function setupMocks() {
    vi.doMock("@aws-sdk/client-s3", () => ({
      S3Client: class MockS3Client {
        send = mockSend;
      },
      PutObjectCommand: class MockPutObjectCommand {
        constructor(public args: any) {}
      },
      GetObjectCommand: class MockGetObjectCommand {
        constructor(public args: any) {}
      },
    }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: vi.fn(() => Promise.resolve("https://example.com")),
    }));
    vi.doMock("@askarthur/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }));
  }

  it("returns null when R2 credentials are not configured", async () => {
    setupMocks();
    const { uploadScreenshot } = await import("@/lib/r2");
    const result = await uploadScreenshot(Buffer.from("test"), "image/png");
    expect(result).toBeNull();
  });

  it("returns key in correct format screenshots/YYYY-MM-DD/{uuid}.{ext}", async () => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";

    setupMocks();
    const { uploadScreenshot } = await import("@/lib/r2");
    const key = await uploadScreenshot(Buffer.from("test"), "image/png");

    expect(key).not.toBeNull();
    expect(key).toMatch(/^screenshots\/\d{4}-\d{2}-\d{2}\/[a-f0-9-]+\.png$/);
  });

  it("uses jpg extension for image/jpeg content type", async () => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";

    setupMocks();
    const { uploadScreenshot } = await import("@/lib/r2");
    const key = await uploadScreenshot(Buffer.from("test"), "image/jpeg");

    expect(key).toMatch(/\.jpg$/);
  });

  it("uses gif extension for image/gif content type", async () => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";

    setupMocks();
    const { uploadScreenshot } = await import("@/lib/r2");
    const key = await uploadScreenshot(Buffer.from("test"), "image/gif");

    expect(key).toMatch(/\.gif$/);
  });

  it("uses webp extension for image/webp content type", async () => {
    process.env.R2_ACCOUNT_ID = "test-account";
    process.env.R2_ACCESS_KEY_ID = "test-key";
    process.env.R2_SECRET_ACCESS_KEY = "test-secret";

    setupMocks();
    const { uploadScreenshot } = await import("@/lib/r2");
    const key = await uploadScreenshot(Buffer.from("test"), "image/webp");

    expect(key).toMatch(/\.webp$/);
  });
});
