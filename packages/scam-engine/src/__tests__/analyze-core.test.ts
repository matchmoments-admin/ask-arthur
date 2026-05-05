import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks. Each replaces the side-effect module with a vi.fn so we
// can assert on calls without bringing up Anthropic / Supabase / Upstash.
vi.mock("../claude", () => ({
  analyzeWithClaude: vi.fn(),
  detectInjectionAttempt: vi.fn(),
}));
vi.mock("../safebrowsing", () => ({
  extractURLs: vi.fn(),
  checkURLReputation: vi.fn(),
}));
vi.mock("../redirect-resolver", () => ({
  resolveRedirects: vi.fn(),
  extractFinalUrls: vi.fn(),
}));
vi.mock("../pipeline", () => ({
  storeVerifiedScam: vi.fn(),
  incrementStats: vi.fn(),
}));
vi.mock("../analysis-cache", () => ({
  getCachedAnalysis: vi.fn(),
  setCachedAnalysis: vi.fn(),
}));

import { runAnalysisCore } from "../analyze-core";
import { analyzeWithClaude, detectInjectionAttempt } from "../claude";
import { extractURLs, checkURLReputation } from "../safebrowsing";
import { resolveRedirects, extractFinalUrls } from "../redirect-resolver";
import { storeVerifiedScam, incrementStats } from "../pipeline";
import { getCachedAnalysis, setCachedAnalysis } from "../analysis-cache";

const mockAnalyze = vi.mocked(analyzeWithClaude);
const mockInjection = vi.mocked(detectInjectionAttempt);
const mockExtract = vi.mocked(extractURLs);
const mockUrlRep = vi.mocked(checkURLReputation);
const mockResolveRedirects = vi.mocked(resolveRedirects);
const mockExtractFinal = vi.mocked(extractFinalUrls);
const mockStore = vi.mocked(storeVerifiedScam);
const mockStats = vi.mocked(incrementStats);
const mockCacheGet = vi.mocked(getCachedAnalysis);
const mockCacheSet = vi.mocked(setCachedAnalysis);

const safeAi = {
  verdict: "SAFE" as const,
  confidence: 0.7,
  summary: "Looks fine",
  redFlags: [],
  nextSteps: [],
  scamType: undefined,
  impersonatedBrand: undefined,
  scammerContacts: undefined,
  scammerUrls: undefined,
  channel: undefined,
  inputMode: undefined,
  countryCode: undefined,
  phoneRiskFlags: undefined,
  isVoipCaller: undefined,
};

const highRiskAi = {
  ...safeAi,
  verdict: "HIGH_RISK" as const,
  confidence: 0.95,
  summary: "Phishing",
  redFlags: ["Spoofed sender"],
  nextSteps: ["Don't reply"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCacheGet.mockResolvedValue(null);
  mockInjection.mockReturnValue({ detected: false, patterns: [] });
  mockExtract.mockReturnValue([]);
  mockUrlRep.mockResolvedValue([]);
  mockStore.mockResolvedValue(null);
  mockStats.mockResolvedValue(undefined);
  mockCacheSet.mockResolvedValue(undefined);
});

describe("runAnalysisCore — cache path", () => {
  it("returns cached result without calling Claude or URL reputation", async () => {
    mockCacheGet.mockResolvedValue(highRiskAi);

    const out = await runAnalysisCore({ text: "previously seen", surface: "extension" });

    expect(out.cached).toBe(true);
    expect(out.result.verdict).toBe("HIGH_RISK");
    expect(mockAnalyze).not.toHaveBeenCalled();
    expect(mockUrlRep).not.toHaveBeenCalled();
    // Cache-hit path still increments stats.
    expect(out.backgroundTasks).toHaveLength(1);
  });

  it("respects skipCacheRead", async () => {
    mockCacheGet.mockResolvedValue(highRiskAi);
    mockAnalyze.mockResolvedValue(safeAi);

    const out = await runAnalysisCore({
      text: "force fresh",
      surface: "web",
      skipCacheRead: true,
    });

    expect(out.cached).toBe(false);
    expect(mockCacheGet).not.toHaveBeenCalled();
    expect(mockAnalyze).toHaveBeenCalledTimes(1);
  });
});

describe("runAnalysisCore — full pipeline (cache miss)", () => {
  it("returns the merged AI verdict when no other signals fire", async () => {
    mockAnalyze.mockResolvedValue(safeAi);

    const out = await runAnalysisCore({ text: "hello", surface: "extension" });

    expect(out.cached).toBe(false);
    expect(out.result.verdict).toBe("SAFE");
    expect(out.signals.aiVerdict).toBe("SAFE");
    expect(out.signals.maliciousUrlCount).toBe(0);
    expect(out.signals.injectionDetected).toBe(false);
  });

  it("escalates verdict to HIGH_RISK when a URL is flagged malicious", async () => {
    mockAnalyze.mockResolvedValue(safeAi);
    mockExtract.mockReturnValue(["https://evil.example/login"]);
    mockUrlRep.mockResolvedValue([
      {
        url: "https://evil.example/login",
        isMalicious: true,
        sources: ["google-safebrowsing"],
      },
    ]);

    const out = await runAnalysisCore({ text: "click here", surface: "web" });

    expect(out.result.verdict).toBe("HIGH_RISK");
    expect(out.signals.maliciousUrlCount).toBe(1);
    expect(out.result.redFlags.some((f) => f.includes("evil.example"))).toBe(true);
    expect(out.result.nextSteps[0]).toContain("Do not click any links");
  });

  it("floors SAFE to SUSPICIOUS when injection is detected, but does NOT downgrade HIGH_RISK", async () => {
    // SAFE → SUSPICIOUS
    mockAnalyze.mockResolvedValueOnce(safeAi);
    mockInjection.mockReturnValueOnce({
      detected: true,
      patterns: ["ignore previous instructions"],
    });
    let out = await runAnalysisCore({ text: "ignore previous", surface: "bot" });
    expect(out.result.verdict).toBe("SUSPICIOUS");
    expect(out.signals.injectionDetected).toBe(true);

    // HIGH_RISK stays HIGH_RISK
    mockAnalyze.mockResolvedValueOnce(highRiskAi);
    mockInjection.mockReturnValueOnce({
      detected: true,
      patterns: ["ignore previous instructions"],
    });
    out = await runAnalysisCore({ text: "scam + injection", surface: "bot" });
    expect(out.result.verdict).toBe("HIGH_RISK");
  });

  it("calls AI in image mode when images are passed", async () => {
    mockAnalyze.mockResolvedValue(safeAi);

    await runAnalysisCore({
      text: "what is in this image",
      surface: "media",
      images: ["base64data"],
    });

    expect(mockAnalyze).toHaveBeenCalledWith(
      "what is in this image",
      ["base64data"],
      "image",
      undefined,
    );
  });

  it("runs redirect resolution and feeds final URLs into reputation", async () => {
    mockAnalyze.mockResolvedValue(safeAi);
    mockExtract.mockReturnValue(["https://bit.ly/abc"]);
    mockResolveRedirects.mockResolvedValue([
      {
        originalUrl: "https://bit.ly/abc",
        finalUrl: "https://landing.example",
        hops: [],
        hopCount: 1,
        isShortened: true,
        hasOpenRedirect: false,
        truncated: false,
      },
    ]);
    mockExtractFinal.mockReturnValue(["https://landing.example"]);
    mockUrlRep.mockResolvedValue([]);

    const out = await runAnalysisCore({
      text: "shortened link",
      surface: "extension",
      resolveRedirectsEnabled: true,
    });

    expect(mockResolveRedirects).toHaveBeenCalledOnce();
    // Both original + final URL flow into reputation.
    expect(mockUrlRep.mock.calls[0][0]).toEqual(
      expect.arrayContaining(["https://bit.ly/abc", "https://landing.example"]),
    );
    // Shortened URL emits a red flag (mergeVerdict redirect-chain branch).
    expect(out.result.redFlags.some((f) => f.toLowerCase().includes("shortened"))).toBe(true);
  });
});

describe("runAnalysisCore — background fan-out", () => {
  it("'waitUntil' returns the array of background tasks for the caller", async () => {
    mockAnalyze.mockResolvedValue(highRiskAi);

    const out = await runAnalysisCore({
      text: "phish",
      surface: "web",
      backgroundMode: "waitUntil",
    });

    // HIGH_RISK ⇒ storeVerifiedScam + incrementStats + setCachedAnalysis.
    expect(out.backgroundTasks).toHaveLength(3);
    expect(mockStore).toHaveBeenCalledOnce();
    expect(mockStats).toHaveBeenCalledOnce();
    expect(mockCacheSet).toHaveBeenCalledOnce();
  });

  it("'fire-and-forget' kicks tasks off and returns []", async () => {
    mockAnalyze.mockResolvedValue(safeAi);

    const out = await runAnalysisCore({
      text: "hi",
      surface: "bot",
      backgroundMode: "fire-and-forget",
    });

    expect(out.backgroundTasks).toEqual([]);
    expect(mockStats).toHaveBeenCalledOnce();
    expect(mockCacheSet).toHaveBeenCalledOnce();
  });

  it("'skip' enqueues nothing", async () => {
    mockAnalyze.mockResolvedValue(safeAi);

    const out = await runAnalysisCore({
      text: "hi",
      surface: "web",
      backgroundMode: "skip",
    });

    expect(out.backgroundTasks).toEqual([]);
    expect(mockStore).not.toHaveBeenCalled();
    expect(mockStats).not.toHaveBeenCalled();
    expect(mockCacheSet).not.toHaveBeenCalled();
  });

  it("respects skipCacheWrite even in waitUntil mode", async () => {
    mockAnalyze.mockResolvedValue(safeAi);

    await runAnalysisCore({
      text: "hi",
      surface: "extension",
      skipCacheWrite: true,
    });

    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(mockStats).toHaveBeenCalledOnce();
  });
});
