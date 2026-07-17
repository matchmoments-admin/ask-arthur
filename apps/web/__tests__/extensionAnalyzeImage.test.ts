import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/extension/analyze-image — flag gate, scheme/SSRF guards, tiered image
// cap, hive_ai brake, and the Hive-only happy path. assertSafeURL is used
// unmocked (pure function) so the SSRF test exercises the real guard.
vi.mock("@askarthur/scam-engine/hive-ai", () => ({
  checkHiveAI: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/claude", () => ({
  analyzeWithClaude: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: vi.fn(async () => false),
}));
vi.mock("@askarthur/scam-engine/ssrf-dispatcher", () => ({
  ssrfSafeDispatcher: {},
}));
// The detector itself is unit-tested in scam-engine with byte fixtures;
// here we only assert the route's threading/unknown-vs-absent semantics.
vi.mock("@askarthur/scam-engine/c2pa-detect", () => ({
  detectC2PA: vi.fn(() => ({ present: true, format: "jpeg" })),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => null),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { imageCheck: true, imageCheckVision: false },
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(async () => ({
    valid: true,
    installId: "test-install",
    remaining: 42,
    requestId: null,
    tier: "free",
  })),
}));
vi.mock("@/app/api/extension/_lib/image-rate-limit", () => ({
  checkImageCheckRateLimit: vi.fn(async () => ({ allowed: true, remaining: 2 })),
}));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cost-telemetry")>();
  return { ...actual, logCost: vi.fn() };
});

import { POST } from "@/app/api/extension/analyze-image/route";
import { checkHiveAI } from "@askarthur/scam-engine/hive-ai";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { validateExtensionRequest } from "@/app/api/extension/_lib/auth";
import { checkImageCheckRateLimit } from "@/app/api/extension/_lib/image-rate-limit";
import { logCost, PRICING } from "@/lib/cost-telemetry";

function makeReq(bodyObj: Record<string, unknown>) {
  const body = JSON.stringify(bodyObj);
  return new NextRequest("http://localhost/api/extension/analyze-image", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

const GOOD_BODY = {
  imageUrl: "https://images.example-social.com/feed/img123.jpg",
  pageUrl: "https://www.example-social.com/feed",
};

beforeEach(() => {
  vi.clearAllMocks();
  (featureFlags as { imageCheck: boolean }).imageCheck = true;
  (featureFlags as { imageCheckVision: boolean }).imageCheckVision = false;
  vi.mocked(isFeatureBraked).mockResolvedValue(false);
  vi.mocked(checkImageCheckRateLimit).mockResolvedValue({ allowed: true, remaining: 2 });
  vi.mocked(checkHiveAI).mockResolvedValue({
    isAiGenerated: true,
    aiConfidence: 0.97,
    isDeepfake: false,
    deepfakeConfidence: 0.12,
    generatorSource: "midjourney",
    classes: [
      { class: "ai_generated", score: 0.97 },
      { class: "not_ai_generated", score: 0.03 },
      { class: "deepfake", score: 0.12 },
      { class: "midjourney", score: 0.62 },
      { class: "dalle", score: 0.21 },
      { class: "flux", score: 0.08 },
      { class: "stablediffusion", score: 0.05 },
    ],
  });
});

describe("analyze-image route", () => {
  it("returns 503 when the server flag is off, before any spend", async () => {
    (featureFlags as { imageCheck: boolean }).imageCheck = false;
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("feature_disabled");
    expect(checkHiveAI).not.toHaveBeenCalled();
  });

  it("rejects data: URLs with a friendly 422", async () => {
    const res = await POST(
      makeReq({ imageUrl: "data:image/png;base64,iVBORw0KGgo=" }),
    );
    // data: fails Zod's .url()? No — it parses; the scheme guard catches it.
    expect([400, 422]).toContain(res.status);
    expect(checkHiveAI).not.toHaveBeenCalled();
  });

  it("rejects private-IP image URLs via the real SSRF guard", async () => {
    const res = await POST(
      makeReq({ imageUrl: "https://169.254.169.254/latest/meta-data.jpg" }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("unsafe_url");
    expect(checkHiveAI).not.toHaveBeenCalled();
  });

  it("returns 429 with upgrade copy when the free image cap is exhausted", async () => {
    vi.mocked(checkImageCheckRateLimit).mockResolvedValue({ allowed: false, remaining: 0 });
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("image_limit_reached");
    expect(json.message).toContain("Upgrade");
    expect(checkHiveAI).not.toHaveBeenCalled();
    // Free tier default: called with the free cap of 3.
    expect(checkImageCheckRateLimit).toHaveBeenCalledWith("test-install", 3);
  });

  it("uses the pro cap when auth resolves a pro tier", async () => {
    vi.mocked(validateExtensionRequest).mockResolvedValueOnce({
      valid: true,
      installId: "test-install",
      remaining: 42,
      requestId: null,
      tier: "pro",
    });
    await POST(makeReq(GOOD_BODY));
    expect(checkImageCheckRateLimit).toHaveBeenCalledWith("test-install", 30);
  });

  it("returns 503 feature_paused while the hive_ai brake is engaged", async () => {
    vi.mocked(isFeatureBraked).mockResolvedValue(true);
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("feature_paused");
    expect(checkHiveAI).not.toHaveBeenCalled();
  });

  it("returns confidences (never a binary verdict) and logs real Hive cost", async () => {
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.checked).toBe(true);
    expect(json.aiGenerated).toEqual({ likely: true, confidence: 0.97 });
    expect(json.deepfake).toEqual({ likely: false, confidence: 0.12 });
    expect(json.generatorSource).toBe("midjourney");
    // Top-3 generator attribution, verdict classes excluded.
    expect(json.generatorBreakdown).toEqual([
      { class: "midjourney", score: 0.62 },
      { class: "dalle", score: 0.21 },
      { class: "flux", score: 0.08 },
    ]);
    expect(json.context).toBeNull();
    expect(json.imageChecksRemaining).toBe(2);
    expect(json.disclaimer).toContain("probabilistic");
    expect(json).not.toHaveProperty("verdict");

    const hiveCost = vi
      .mocked(logCost)
      .mock.calls.map(([ev]) => ev)
      .find((ev) => ev.feature === "hive_ai");
    expect(hiveCost).toBeDefined();
    expect(hiveCost!.unitCostUsd).toBe(PRICING.HIVE_AI_USD_PER_IMAGE);
    expect(hiveCost!.metadata?.surface).toBe("image_check");
  });

  it("returns generatorBreakdown: null for pre-v2 cached results (no classes field)", async () => {
    vi.mocked(checkHiveAI).mockResolvedValue({
      isAiGenerated: true,
      aiConfidence: 0.95,
      isDeepfake: false,
      deepfakeConfidence: 0.1,
      generatorSource: "dalle",
    });
    const res = await POST(makeReq(GOOD_BODY));
    const json = await res.json();
    expect(json.generatorBreakdown).toBeNull();
    expect(json.generatorSource).toBe("dalle");
  });

  it("vision brake pauses ONLY the Claude call — Hive verdict intact, context null", async () => {
    (featureFlags as { imageCheckVision: boolean }).imageCheckVision = true;
    // hive_ai unbraked, extension_image_check braked.
    vi.mocked(isFeatureBraked).mockImplementation(
      async (feature: string) => feature === "extension_image_check",
    );
    // Real JPEG magic bytes so the (unmocked) magic-byte validator passes.
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => String(jpegBytes.length) },
        arrayBuffer: async () => jpegBytes.buffer,
      })),
    );

    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.checked).toBe(true);
    expect(json.aiGenerated?.confidence).toBeCloseTo(0.97);
    expect(json.context).toBeNull();
    expect(analyzeWithClaude).not.toHaveBeenCalled();
    const anthropicCost = vi
      .mocked(logCost)
      .mock.calls.map(([ev]) => ev)
      .find((ev) => ev.provider === "anthropic");
    expect(anthropicCost).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("vision runs when unbraked: Claude called, context returned", async () => {
    (featureFlags as { imageCheckVision: boolean }).imageCheckVision = true;
    vi.mocked(isFeatureBraked).mockResolvedValue(false);
    vi.mocked(analyzeWithClaude).mockResolvedValue({
      verdict: "SUSPICIOUS",
      confidence: 0.8,
      summary: "Appears to show a public figure endorsing an investment platform.",
      redFlags: [],
      nextSteps: [],
      impersonatedBrand: null,
      usage: { inputTokens: 900, outputTokens: 120 },
    } as never);
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => String(jpegBytes.length) },
        arrayBuffer: async () => jpegBytes.buffer,
      })),
    );

    const res = await POST(makeReq(GOOD_BODY));
    const json = await res.json();
    expect(analyzeWithClaude).toHaveBeenCalled();
    expect(json.context?.summary).toContain("investment platform");
    vi.unstubAllGlobals();
  });

  it("C2PA presence is reported from fetched bytes — even while the vision brake is on", async () => {
    (featureFlags as { imageCheckVision: boolean }).imageCheckVision = true;
    vi.mocked(isFeatureBraked).mockImplementation(
      async (feature: string) => feature === "extension_image_check",
    );
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: () => String(jpegBytes.length) },
        arrayBuffer: async () => jpegBytes.buffer,
      })),
    );

    const res = await POST(makeReq(GOOD_BODY));
    const json = await res.json();
    expect(json.contentCredentials).toEqual({ present: true, format: "jpeg" });
    expect(json.context).toBeNull(); // vision braked — Claude untouched
    vi.unstubAllGlobals();
  });

  it("C2PA is null (unknown) when the byte fetch fails — never fabricated", async () => {
    (featureFlags as { imageCheckVision: boolean }).imageCheckVision = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, headers: { get: () => "0" } })),
    );
    const res = await POST(makeReq(GOOD_BODY));
    const json = await res.json();
    expect(json.contentCredentials).toBeNull();
    vi.unstubAllGlobals();
  });

  it("C2PA is null when the vision flag is off (no byte fetch at all)", async () => {
    const res = await POST(makeReq(GOOD_BODY));
    const json = await res.json();
    expect(json.contentCredentials).toBeNull();
  });

  it("reports checked:false (scan_unavailable) when Hive returns null", async () => {
    vi.mocked(checkHiveAI).mockResolvedValue(null);
    const res = await POST(makeReq(GOOD_BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.checked).toBe(false);
    expect(json.reason).toBe("scan_unavailable");
    expect(json.aiGenerated).toBeNull();
  });
});
