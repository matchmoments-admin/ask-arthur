import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// v243: the analyze-ad flagged_ads upsert must tag the impersonated brand on
// EVERY non-SAFE ad — not just when it matches a monitored celebrity — so the
// Scam-Ad Observatory has brand-tagged telemetry to farm. This test captures
// the upsert payload and asserts both the raw brand and its canonical key land.

vi.mock("@askarthur/scam-engine/claude", () => ({ analyzeWithClaude: vi.fn() }));
vi.mock("@askarthur/scam-engine/safebrowsing", () => ({
  extractURLs: vi.fn(() => []),
  checkURLReputation: vi.fn(async () => []),
}));
vi.mock("@askarthur/scam-engine/hive-ai", () => ({ checkHiveAI: vi.fn() }));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: vi.fn(async () => false),
}));
vi.mock("@askarthur/core-analysis", () => ({
  mergeVerdict: vi.fn(() => ({
    verdict: "SUSPICIOUS",
    redFlags: [],
    signals: { maliciousUrlCount: 0 },
  })),
}));

// Capture the flagged_ads upsert payload.
const upsertMock = vi.fn(
  async (_payload: Record<string, unknown>) => ({ error: null }),
);
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({ upsert: upsertMock })),
  })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { facebookAds: true },
}));
// Run the fire-and-forget upsert IIFE to completion so we can assert on it.
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => p),
}));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(async () => ({
    valid: true,
    installId: "test-install",
    remaining: 42,
    requestId: null,
  })),
}));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cost-telemetry")>();
  return { ...actual, logCost: vi.fn() };
});

import { POST } from "@/app/api/extension/analyze-ad/route";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";

// No imageUrl → the Hive + celebrity-match branches are skipped; the ad is
// still non-SAFE (mergeVerdict stub), so the flagged_ads upsert runs.
function makeReq(overrides: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    adText: "Login to your NAB account to verify — act now",
    landingUrl: "https://nab-secure-verify.example.com",
    advertiserName: "Totally Real Bank Support",
    adTextHash: "hash-nab-1",
    ...overrides,
  });
  return new NextRequest("http://localhost/api/extension/analyze-ad", {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "content-length": String(body.length) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

describe("analyze-ad — impersonated brand tag (v243)", () => {
  it("tags a non-celebrity brand on the flagged_ads upsert", async () => {
    vi.mocked(analyzeWithClaude).mockResolvedValue({
      verdict: "SUSPICIOUS",
      confidence: 0.9,
      summary: "Bank phishing bait",
      redFlags: ["credential harvest"],
      nextSteps: [],
      impersonatedBrand: "NAB",
      usage: { inputTokens: 80, outputTokens: 40 },
    } as never);

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0)); // flush the fire-and-forget upsert

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [payload] = upsertMock.mock.calls[0];
    expect(payload).toMatchObject({
      ad_text_hash: "hash-nab-1",
      verdict: "SUSPICIOUS",
      impersonated_brand: "NAB",
      impersonated_brand_key: "nab", // brandNormalize: lowercase, strip to [a-z0-9]
      impersonated_celebrity: null, // not a monitored celebrity
    });
  });

  it("writes null brand tags when Claude names no brand", async () => {
    vi.mocked(analyzeWithClaude).mockResolvedValue({
      verdict: "SUSPICIOUS",
      confidence: 0.7,
      summary: "Generic scam",
      redFlags: [],
      nextSteps: [],
      impersonatedBrand: null,
      usage: { inputTokens: 50, outputTokens: 20 },
    } as never);

    const res = await POST(makeReq({ adTextHash: "hash-none" }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 0));

    const [payload] = upsertMock.mock.calls[0];
    expect(payload.impersonated_brand).toBeNull();
    expect(payload.impersonated_brand_key).toBeNull();
  });
});
