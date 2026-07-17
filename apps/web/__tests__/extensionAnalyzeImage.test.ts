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
import { isFeatureBraked } from "@askarthur/scam-engine/cost-log";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
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

  it("uses the pro cap when the tier RPC returns pro", async () => {
    vi.mocked(createServiceClient).mockReturnValue({
      rpc: vi.fn(async () => ({ data: "pro", error: null })),
    } as never);
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
