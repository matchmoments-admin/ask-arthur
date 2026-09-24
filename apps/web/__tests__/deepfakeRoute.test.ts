import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rate: vi.fn(),
  braked: vi.fn(),
  analyze: vi.fn(),
  logCost: vi.fn(),
}));

vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: { deepfakeDetection: true } }));
vi.mock("@askarthur/utils/rate-limit", () => ({ checkDeepfakeRateLimit: m.rate }));
vi.mock("@askarthur/scam-engine/cost-log", () => ({ isFeatureBrakedOrUnknown: m.braked }));
vi.mock("@askarthur/scam-engine/deepfake-detect", () => ({ analyzeAudioForDeepfake: m.analyze }));
vi.mock("@/lib/cost-telemetry", () => ({ logCost: m.logCost }));

import { POST } from "@/app/api/deepfake/route";

function audioRequest() {
  const form = new FormData();
  form.set("audio", new File([new Uint8Array(100)], "a.wav", { type: "audio/wav" }));
  return new Request("https://x.test/api/deepfake", {
    method: "POST",
    headers: { "x-real-ip": "1.2.3.4" },
    body: form,
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.rate.mockResolvedValue({ allowed: true, remaining: 9, resetAt: null });
  m.braked.mockResolvedValue(false);
  m.analyze.mockResolvedValue({ isDeepfake: false, confidence: 0.1, provider: "reality_defender" });
});

describe("POST /api/deepfake", () => {
  it("analyses, and logs the vendor call", async () => {
    const res = await POST(audioRequest());
    expect(res.status).toBe(200);
    expect(m.rate).toHaveBeenCalledWith("1.2.3.4");
    expect(m.logCost).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "deepfake", provider: "reality_defender", units: 1 }),
    );
  });

  it("429s over the per-IP limit without calling the vendor", async () => {
    m.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date(Date.now() + 60_000), reason: "exceeded" });
    const res = await POST(audioRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(m.analyze).not.toHaveBeenCalled();
  });

  it("503s when the limiter store is unavailable (fail-closed), not 429", async () => {
    m.rate.mockResolvedValue({ allowed: false, remaining: 0, resetAt: null, reason: "store_unavailable" });
    expect((await POST(audioRequest())).status).toBe(503);
    expect(m.analyze).not.toHaveBeenCalled();
  });

  it("503s when the deepfake brake is engaged or unreadable", async () => {
    m.braked.mockResolvedValue(true);
    expect((await POST(audioRequest())).status).toBe(503);
    expect(m.analyze).not.toHaveBeenCalled();
  });

  it("logs nothing when no vendor is configured", async () => {
    m.analyze.mockResolvedValue({ isDeepfake: false, confidence: 0, provider: "none" });
    await POST(audioRequest());
    expect(m.logCost).not.toHaveBeenCalled();
  });
});

describe("POST /api/deepfake — quota is spent last", () => {
  it("does not consume a rate-limit token for invalid input", async () => {
    const form = new FormData();
    form.set("audio", new File([new Uint8Array(10)], "a.txt", { type: "text/plain" }));
    const res = await POST(
      new Request("https://x.test/api/deepfake", { method: "POST", headers: { "x-real-ip": "1.2.3.4" }, body: form }) as never,
    );
    expect(res.status).toBe(400);
    expect(m.rate).not.toHaveBeenCalled();
  });

  it("does not consume a rate-limit token while braked", async () => {
    m.braked.mockResolvedValue(true);
    expect((await POST(audioRequest())).status).toBe(503);
    expect(m.rate).not.toHaveBeenCalled();
  });
});
