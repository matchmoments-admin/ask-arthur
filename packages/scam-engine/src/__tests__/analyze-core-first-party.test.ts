import { describe, it, expect, vi, beforeEach } from "vitest";

// runAnalysisCore (extension + bots) must route URL reputation through the
// first-party-aware helper, so a Weaponised clone held in scam_urls escalates
// the verdict on those surfaces too — not only on the web route. This drives
// the REAL first-party module + REAL mergeVerdict; only I/O is mocked.

vi.mock("../claude", () => ({
  analyzeWithClaude: vi.fn(),
  detectInjectionAttempt: vi.fn(() => ({ detected: false, patterns: [] })),
  MARKETPLACE_PROMPT_BLOCK: "",
}));
vi.mock("../safebrowsing", () => ({
  extractURLs: vi.fn(),
  checkURLReputation: vi.fn(async () => []),
}));
vi.mock("../redirect-resolver", () => ({
  resolveRedirects: vi.fn(),
  extractFinalUrls: vi.fn(),
}));
vi.mock("../pipeline", () => ({
  storeVerifiedScam: vi.fn(async () => null),
  incrementStats: vi.fn(async () => undefined),
}));
vi.mock("../analysis-cache", () => ({
  getCachedAnalysis: vi.fn(async () => null),
  setCachedAnalysis: vi.fn(async () => undefined),
  analyzeOutputAffectingFlags: vi.fn(() => ({})),
}));
vi.mock("../retrieval/themes", () => ({
  getRelevantThemes: vi.fn(async () => []),
  renderThemesForPrompt: vi.fn(() => ""),
}));
vi.mock("../shop-signal", () => ({ applyShopSignal: vi.fn() }));
vi.mock("../asic-lookup", () => ({ applyAsicCitation: vi.fn(async () => null) }));
vi.mock("../cost-log", () => ({ logCost: vi.fn() }));

const flags = { analyzeFirstPartyUrls: true, asicLookup: false };
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), flush: async () => {} }),
}));

let rows: unknown[] = [];
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => {
    const b: Record<string, unknown> = {};
    for (const m of ["from", "select", "in", "eq", "overlaps", "limit"]) b[m] = () => b;
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
    return b;
  },
}));

const { runAnalysisCore } = await import("../analyze-core");
const { analyzeWithClaude } = await import("../claude");
const { extractURLs } = await import("../safebrowsing");

const CLONE = "https://paymentsrevolut.com/secure";

beforeEach(() => {
  flags.analyzeFirstPartyUrls = true;
  rows = [];
  vi.mocked(extractURLs).mockReturnValue([CLONE]);
  vi.mocked(analyzeWithClaude).mockResolvedValue({
    verdict: "SAFE",
    confidence: 0.6,
    summary: "Looks like a payment page",
    redFlags: [],
    nextSteps: [],
  } as never);
});

describe("runAnalysisCore — first-party URL reputation", () => {
  it("a Weaponised clone in scam_urls turns an AI SAFE into HIGH_RISK", async () => {
    rows = [
      {
        normalized_url: "https://paymentsrevolut.com/",
        brand_impersonated: "revolut.com",
        feed_sources: ["clone_watch"],
      },
    ];
    const out = await runAnalysisCore({ text: `pay here ${CLONE}`, surface: "bot", backgroundMode: "skip" });
    expect(out.result.verdict).toBe("HIGH_RISK");
    expect(out.signals.maliciousUrlCount).toBe(1);
    expect(out.result.redFlags).toEqual([
      `URL flagged by Ask Arthur Clone Watch (live impersonation of revolut.com): ${CLONE}`,
    ]);
  });

  it("no first-party row → AI verdict stands", async () => {
    const out = await runAnalysisCore({ text: `pay here ${CLONE}`, surface: "extension", backgroundMode: "skip" });
    expect(out.result.verdict).toBe("SAFE");
  });

  it("flag OFF → the row is not consulted", async () => {
    flags.analyzeFirstPartyUrls = false;
    rows = [
      { normalized_url: "https://paymentsrevolut.com/", brand_impersonated: "revolut.com", feed_sources: ["clone_watch"] },
    ];
    const out = await runAnalysisCore({ text: `pay here ${CLONE}`, surface: "bot", backgroundMode: "skip" });
    expect(out.result.verdict).toBe("SAFE");
  });
});
