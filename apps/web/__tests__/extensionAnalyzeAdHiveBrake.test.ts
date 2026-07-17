import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The analyze-ad Hive call site: (1) skips checkHiveAI while the hive_ai
// feature brake is engaged, (2) logs the real per-image unit cost from
// PRICING (no more $0 placeholder).
vi.mock("@askarthur/scam-engine/claude", () => ({
  analyzeWithClaude: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/safebrowsing", () => ({
  extractURLs: vi.fn(() => []),
  checkURLReputation: vi.fn(async () => []),
}));
vi.mock("@askarthur/scam-engine/hive-ai", () => ({
  checkHiveAI: vi.fn(),
}));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: vi.fn(),
}));
vi.mock("@askarthur/core-analysis", () => ({
  mergeVerdict: vi.fn(() => ({
    verdict: "SUSPICIOUS",
    redFlags: [],
    signals: { maliciousUrlCount: 0 },
  })),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => null),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { facebookAds: true },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn(),
}));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(async () => ({
    valid: true,
    installId: "test-install",
    remaining: 42,
    requestId: null,
  })),
}));
// Keep PRICING real (that's what we're asserting against); stub only logCost.
vi.mock("@/lib/cost-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cost-telemetry")>();
  return { ...actual, logCost: vi.fn() };
});

import { POST } from "@/app/api/extension/analyze-ad/route";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { checkHiveAI } from "@askarthur/scam-engine/hive-ai";
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { logCost, PRICING } from "@/lib/cost-telemetry";

function makeReq() {
  const body = JSON.stringify({
    adText: "Gina Rinehart's shocking investment secret revealed",
    landingUrl: "https://dodgy-invest.example.com",
    imageUrl: "https://scontent.xx.fbcdn.net/v/celeb.jpg",
    advertiserName: "Totally Real Finance",
    adTextHash: "abc123",
  });
  return new NextRequest("http://localhost/api/extension/analyze-ad", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // No Upstash env in tests → checkImageRateLimit fails open (non-prod).
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.mocked(analyzeWithClaude).mockResolvedValue({
    verdict: "SUSPICIOUS",
    confidence: 0.85,
    summary: "Celebrity investment bait",
    redFlags: ["celebrity endorsement"],
    nextSteps: [],
    impersonatedBrand: null,
    usage: { inputTokens: 100, outputTokens: 50 },
  } as never);
  vi.mocked(checkHiveAI).mockResolvedValue({
    isAiGenerated: true,
    aiConfidence: 0.95,
    isDeepfake: false,
    deepfakeConfidence: 0.1,
    generatorSource: "midjourney",
  } as never);
});

describe("analyze-ad Hive brake gate + real unit cost", () => {
  it("skips checkHiveAI entirely when the hive_ai brake is engaged", async () => {
    vi.mocked(isFeatureBraked).mockResolvedValue(true);

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(isFeatureBraked).toHaveBeenCalledWith("hive_ai");
    expect(checkHiveAI).not.toHaveBeenCalled();
    // Response degrades gracefully: text verdict still returned, no image signals.
    expect(json.verdict).toBe("SUSPICIOUS");
    expect(json.aiGeneratedImage).toBe(false);
    expect(json.deepfakeDetected).toBe(false);
  });

  it("calls Hive when not braked and logs the real per-image cost", async () => {
    vi.mocked(isFeatureBraked).mockResolvedValue(false);

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(checkHiveAI).toHaveBeenCalledWith("https://scontent.xx.fbcdn.net/v/celeb.jpg");
    expect(json.aiGeneratedImage).toBe(true);

    const hiveCall = vi
      .mocked(logCost)
      .mock.calls.map(([ev]) => ev)
      .find((ev) => ev.feature === "hive_ai");
    expect(hiveCall).toBeDefined();
    expect(hiveCall!.provider).toBe("hive");
    expect(hiveCall!.unitCostUsd).toBe(PRICING.HIVE_AI_USD_PER_IMAGE);
    expect(PRICING.HIVE_AI_USD_PER_IMAGE).toBeGreaterThan(0);
  });
});
