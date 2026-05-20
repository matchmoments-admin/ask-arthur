import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createServiceClientMock, inngestSendMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  createServiceClientMock: vi.fn(),
  inngestSendMock: vi.fn(),
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

vi.mock("../inngest/client", () => ({
  inngest: { send: inngestSendMock },
}));

import {
  persistAndEmitShopSignalEvaluation,
  sourceSurfaceForAnalyzeSurface,
} from "../shop-checks";

const shopSignal = {
  isCommerce: true as const,
  commerceFlags: ["payid-scam"],
  generatedAt: "2026-05-20T09:00:00.000Z",
  referrerSource: "instagram-inapp" as const,
};

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({
    data: "11111111-1111-4111-8111-111111111111",
    error: null,
  });
  createServiceClientMock.mockReset().mockReturnValue({ rpc: rpcMock });
  inngestSendMock.mockReset().mockResolvedValue(undefined);
});

describe("persistAndEmitShopSignalEvaluation", () => {
  it("writes shop_checks via RPC and emits the paid-provider event", async () => {
    const out = await persistAndEmitShopSignalEvaluation({
      requestId: "req_12345678",
      urls: ["https://Example.SHOP/cart?utm_source=test&sku=1"],
      verdict: "SUSPICIOUS",
      confidence: 0.78,
      shopSignal,
      sourceSurface: "mobile-share",
    });

    expect(out).toEqual({ shopCheckId: "11111111-1111-4111-8111-111111111111" });
    expect(rpcMock).toHaveBeenCalledWith(
      "upsert_shop_check",
      expect.objectContaining({
        p_idempotency_key:
          "shop_signal:req_12345678:https://example.shop/cart?sku=1",
        p_url_hash: expect.stringMatching(/^\\x[0-9a-f]{64}$/),
        p_url_normalized: "https://example.shop/cart?sku=1",
        p_verdict: "SUSPICIOUS",
        p_signal: shopSignal,
        p_request_id: "req_12345678",
        p_source_surface: "mobile-share",
        p_referrer_source: "instagram-inapp",
      }),
    );
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "shop.signal.evaluated.v1",
      id: "req_12345678",
      data: {
        requestId: "req_12345678",
        host: "example.shop",
        urls: ["https://Example.SHOP/cart?utm_source=test&sku=1"],
        shopCheckId: "11111111-1111-4111-8111-111111111111",
        shopSignal,
      },
    });
  });

  it("skips URL-less commerce detections because APIVoid needs a host", async () => {
    const out = await persistAndEmitShopSignalEvaluation({
      urls: [],
      verdict: "SUSPICIOUS",
      confidence: 0.7,
      shopSignal,
    });

    expect(out).toEqual({ skipped: "no_normalizable_url" });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });
});

describe("sourceSurfaceForAnalyzeSurface", () => {
  it("marks web share-target traffic as mobile-share", () => {
    expect(sourceSurfaceForAnalyzeSurface("web", true)).toBe("mobile-share");
    expect(sourceSurfaceForAnalyzeSurface("web", false)).toBe("web");
    expect(sourceSurfaceForAnalyzeSurface("extension", false)).toBe("extension");
    expect(sourceSurfaceForAnalyzeSurface("bot", false)).toBeNull();
  });
});
