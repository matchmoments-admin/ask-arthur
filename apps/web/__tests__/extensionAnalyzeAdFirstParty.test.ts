import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * analyze-ad is an analyze surface: its landing-URL reputation must come from
 * the ONE seam (checkAnalyzeUrlReputation — GSB/VT + First-party URL
 * Reputation), so a Weaponised clone behind a Facebook ad escalates exactly as
 * it does on /api/analyze.
 *
 * Go-red (2026-09-23): swap the route back to
 * `checkURLReputation(extractURLs(landingUrl))` → both tests fail (the seam is
 * never called; mergeVerdict gets [] instead of the first-party hit).
 */

const seam = vi.hoisted(() => vi.fn());
vi.mock("@askarthur/scam-engine/first-party-url-reputation", () => ({
  checkAnalyzeUrlReputation: seam,
}));
vi.mock("@askarthur/scam-engine/claude", () => ({ analyzeWithClaude: vi.fn() }));
vi.mock("@askarthur/scam-engine/safebrowsing", () => ({
  extractURLs: vi.fn((t: string) => [t]),
  checkURLReputation: vi.fn(async () => []),
}));
vi.mock("@askarthur/scam-engine/hive-ai", () => ({ checkHiveAI: vi.fn() }));
vi.mock("@askarthur/scam-engine/cost-log", () => ({
  isFeatureBraked: vi.fn(async () => false),
}));
vi.mock("@askarthur/core-analysis", () => ({
  mergeVerdict: vi.fn(() => ({
    verdict: "HIGH_RISK",
    redFlags: [],
    signals: { maliciousUrlCount: 1 },
  })),
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: vi.fn(() => null) }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: { facebookAds: true } }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/app/api/extension/_lib/auth", () => ({
  validateExtensionRequest: vi.fn(async () => ({
    valid: true,
    installId: "test-install",
    remaining: 42,
    requestId: "req-1",
  })),
}));
vi.mock("@/lib/cost-telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cost-telemetry")>();
  return { ...actual, logCost: vi.fn() };
});

import { POST } from "@/app/api/extension/analyze-ad/route";
import { analyzeWithClaude } from "@askarthur/scam-engine/claude";
import { mergeVerdict } from "@askarthur/core-analysis";

const LANDING = "https://coinbase-transaction.shop/login";
const HIT = {
  url: LANDING,
  isMalicious: true,
  sources: ["Ask Arthur Clone Watch (live impersonation of coinbase.com)"],
};

function makeReq() {
  const body = JSON.stringify({
    adText: "Your Coinbase wallet is locked — verify now",
    landingUrl: LANDING,
    advertiserName: "Coinbase Support",
    adTextHash: "hash-cb-1",
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
  seam.mockResolvedValue([HIT]);
  vi.mocked(analyzeWithClaude).mockResolvedValue({
    verdict: "SUSPICIOUS",
    confidence: 0.8,
    summary: "Wallet lock bait",
    redFlags: [],
    nextSteps: [],
    impersonatedBrand: null,
    usage: { inputTokens: 10, outputTokens: 10 },
  } as never);
});

describe("analyze-ad — landing URL through the shared reputation seam", () => {
  it("calls checkAnalyzeUrlReputation with the landing URL and a source tag", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(seam).toHaveBeenCalledWith([LANDING], {
      requestId: "req-1",
      source: "api/extension/analyze-ad",
    });
  });

  it("hands the first-party hit to mergeVerdict as a urlResults entry", async () => {
    await POST(makeReq());
    expect(vi.mocked(mergeVerdict).mock.calls[0]?.[0]).toMatchObject({ urlResults: [HIT] });
  });
});
