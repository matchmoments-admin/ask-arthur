import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Public /api/image-check — flag gate, per-IP rate limit, SSRF guard, the
// URL mode (Hive + AI-origin ladder) and the upload mode (deterministic
// ladder only, no classifier). assertSafeURL + c2pa-detect +
// metadata-origin + image-validate run unmocked (pure).
vi.mock("@askarthur/scam-engine/hive-ai", () => ({
  checkHiveAI: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: vi.fn(async () => false),
}));
vi.mock("@askarthur/scam-engine/image-fetch", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@askarthur/scam-engine/image-fetch")>();
  return { ...actual, fetchImageBytes: vi.fn() };
});
vi.mock("@askarthur/utils/rate-limit", () => ({
  checkImageUploadRateLimit: vi.fn(async () => ({
    allowed: true,
    remaining: 4,
    resetAt: null,
  })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { imageCheck: true, imageCheckC2paValidate: false },
}));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cost-telemetry")>();
  return { ...actual, logCost: vi.fn() };
});

import { POST } from "@/app/api/image-check/route";
import { checkHiveAI } from "@askarthur/scam-engine/hive-ai";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { fetchImageBytes } from "@askarthur/scam-engine/image-fetch";
import { checkImageUploadRateLimit } from "@askarthur/utils/rate-limit";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logCost } from "@/lib/cost-telemetry";

// Minimal real JPEG bytes (SOI + JFIF APP0 + SOS + EOI) — passes magic-byte
// validation; carries no C2PA manifest and no metadata tags.
const PLAIN_JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x07]),
  Buffer.from("JFIF\0", "ascii"),
  Buffer.from([0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]),
]);

const HIVE_RESULT = {
  isAiGenerated: true,
  aiConfidence: 0.97,
  isDeepfake: false,
  deepfakeConfidence: 0.02,
  generatorSource: "midjourney",
  classes: [
    { class: "ai_generated", score: 0.97 },
    { class: "midjourney", score: 0.9 },
  ],
};

function urlReq(imageUrl: string) {
  const body = JSON.stringify({ imageUrl });
  return new NextRequest("http://localhost/api/image-check", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

function uploadReq(bytes: Buffer, name = "test.jpg") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }), name);
  return new NextRequest("http://localhost/api/image-check", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (featureFlags as Record<string, boolean>).imageCheck = true;
  vi.mocked(isFeatureBraked).mockResolvedValue(false);
  vi.mocked(checkImageUploadRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 4,
    resetAt: null,
  });
});

describe("POST /api/image-check", () => {
  it("503s when the imageCheck flag is off", async () => {
    (featureFlags as Record<string, boolean>).imageCheck = false;
    const res = await POST(urlReq("https://example.com/a.jpg"));
    expect(res.status).toBe(503);
  });

  it("429s with Retry-After when the per-IP limit is hit", async () => {
    vi.mocked(checkImageUploadRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(Date.now() + 60_000),
      message: "Too many image uploads. Try again later.",
    });
    const res = await POST(urlReq("https://example.com/a.jpg"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("422s a private-IP URL via the real SSRF guard", async () => {
    const res = await POST(urlReq("https://192.168.1.10/internal.jpg"));
    expect(res.status).toBe(422);
    expect(vi.mocked(checkHiveAI)).not.toHaveBeenCalled();
  });

  it("URL mode: Hive signals + deterministic ladder + sha256, cost logged to image_check_web", async () => {
    vi.mocked(checkHiveAI).mockResolvedValue(HIVE_RESULT as never);
    vi.mocked(fetchImageBytes).mockResolvedValue({
      buffer: PLAIN_JPEG,
      base64: PLAIN_JPEG.toString("base64"),
      sha256: "ab".repeat(32),
    });
    const res = await POST(urlReq("https://images.example.com/a.jpg"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      checked: true,
      mode: "url",
      aiGenerated: { likely: true, confidence: 0.97 },
      contentCredentials: { present: false },
      metadataOrigin: { claimed: false },
      imageSha256: "ab".repeat(32),
    });
    expect(body.generatorBreakdown).toEqual([{ class: "midjourney", score: 0.9 }]);
    expect(vi.mocked(logCost)).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "hive_ai",
        metadata: expect.objectContaining({ surface: "image_check_web" }),
      }),
    );
  });

  it("URL mode with hive_ai braked: no Hive call, ladder still returned", async () => {
    vi.mocked(isFeatureBraked).mockResolvedValue(true);
    vi.mocked(fetchImageBytes).mockResolvedValue({
      buffer: PLAIN_JPEG,
      base64: PLAIN_JPEG.toString("base64"),
      sha256: "cd".repeat(32),
    });
    const res = await POST(urlReq("https://images.example.com/a.jpg"));
    const body = await res.json();
    expect(vi.mocked(checkHiveAI)).not.toHaveBeenCalled();
    expect(body.checked).toBe(true);
    expect(body.aiGenerated).toBeNull();
    expect(body.contentCredentials).toEqual({ present: false });
  });

  it("URL mode: scan_unavailable only when BOTH Hive and bytes fail", async () => {
    vi.mocked(checkHiveAI).mockResolvedValue(null as never);
    vi.mocked(fetchImageBytes).mockResolvedValue(null);
    const res = await POST(urlReq("https://images.example.com/a.jpg"));
    const body = await res.json();
    expect(body).toMatchObject({ checked: false, reason: "scan_unavailable" });
  });

  it("upload mode: deterministic ladder only — classifier stays null, nothing paid runs", async () => {
    const res = await POST(uploadReq(PLAIN_JPEG));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      checked: true,
      mode: "upload",
      aiGenerated: null,
      deepfake: null,
      contentCredentials: { present: false },
      metadataOrigin: { claimed: false },
    });
    expect(typeof body.imageSha256).toBe("string");
    expect(vi.mocked(checkHiveAI)).not.toHaveBeenCalled();
    expect(vi.mocked(logCost)).not.toHaveBeenCalled();
  });

  it("upload mode: 422s a non-image file via real magic-byte validation", async () => {
    const res = await POST(uploadReq(Buffer.from("definitely not an image")));
    expect(res.status).toBe(422);
  });
});
