import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/analyze × First-party URL Reputation (clone-watch deepening PR 5).
//   1. URL reputation goes through the shared first-party-aware helper, so a
//      Weaponised clone escalates the verdict via mergeVerdict like a GSB hit.
//   2. The post-hoc clone citation does not re-cite a URL the first-party
//      source already flagged (one red flag per finding, not two).

const CLONE = "https://paymentsrevolut.com/secure";
const LOOKALIKE = "https://revolut-help.xyz/";

vi.mock("@askarthur/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: null })),
  checkImageUploadRateLimit: vi.fn(async () => ({ allowed: true, remaining: 4, resetAt: null })),
}));
vi.mock("@askarthur/scam-engine/claude", () => ({
  analyzeWithClaude: vi.fn(async () => ({
    verdict: "SAFE",
    confidence: 0.6,
    summary: "Looks like a payment page",
    redFlags: [],
    nextSteps: [],
  })),
  detectInjectionAttempt: vi.fn(() => ({ detected: false, patterns: [] })),
}));
vi.mock("@askarthur/scam-engine/safebrowsing", () => ({
  extractURLs: vi.fn(() => [CLONE, LOOKALIKE]),
  checkURLReputation: vi.fn(async () => []),
}));
const checkAnalyzeUrlReputation = vi.fn();
vi.mock("@askarthur/scam-engine/first-party-url-reputation", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@askarthur/scam-engine/first-party-url-reputation")
  >();
  return {
    ...actual,
    checkAnalyzeUrlReputation: (...a: unknown[]) => checkAnalyzeUrlReputation(...a),
  };
});
const lookupCloneAlert = vi.fn();
vi.mock("@/lib/clone-alert-lookup", () => ({
  lookupCloneAlert: (...a: unknown[]) => lookupCloneAlert(...a),
}));
vi.mock("@/lib/analytics-events", () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock("@askarthur/utils/feature-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@askarthur/utils/feature-flags")>();
  return {
    ...actual,
    featureFlags: {
      ...actual.featureFlags,
      analyzeCloneCitation: true,
      analyzeFirstPartyUrls: true,
      asicLookup: false,
      analyzeInngestWeb: false,
      intelligenceCore: false,
      redirectResolve: false,
      ragThemes: false,
    },
  };
});
vi.mock("@askarthur/scam-engine/redirect-resolver", () => ({
  resolveRedirects: vi.fn(async () => []),
  extractFinalUrls: vi.fn(() => []),
}));
vi.mock("@askarthur/scam-engine/geolocate", () => ({
  geolocateIP: vi.fn(async () => ({ region: "AU", countryCode: "AU" })),
  geolocateFromHeaders: vi.fn(() => ({ region: "AU", countryCode: "AU" })),
}));
vi.mock("@askarthur/scam-engine/pipeline", () => ({
  storeVerifiedScam: vi.fn(async () => {}),
  incrementStats: vi.fn(async () => {}),
}));
vi.mock("@askarthur/scam-engine/analysis-cache", () => ({
  getCachedAnalysis: vi.fn(async () => null),
  setCachedAnalysis: vi.fn(async () => {}),
  analyzeOutputAffectingFlags: vi.fn(() => ({ asicLookup: false, firstPartyUrls: true })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  maskE164: vi.fn((v: string) => v),
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => p),
  ipAddress: vi.fn(() => "1.2.3.4"),
}));

const { POST } = await import("@/app/api/analyze/route");

function makeRequest(text: string): NextRequest {
  const json = JSON.stringify({ text });
  return new NextRequest("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "1.2.3.4",
      "user-agent": "test-agent",
      "content-length": String(Buffer.byteLength(json)),
    },
    body: json,
  });
}

const FIRST_PARTY_LABEL = "Ask Arthur Clone Watch (live impersonation of revolut.com)";

beforeEach(() => {
  checkAnalyzeUrlReputation.mockReset();
  lookupCloneAlert.mockReset();
  lookupCloneAlert.mockResolvedValue(null);
  checkAnalyzeUrlReputation.mockResolvedValue([
    { url: CLONE, isMalicious: true, sources: [FIRST_PARTY_LABEL] },
    { url: LOOKALIKE, isMalicious: false, sources: [] },
  ]);
});

describe("/api/analyze — first-party URL reputation", () => {
  it("routes URL reputation through the shared helper and escalates a Weaponised clone to HIGH_RISK", async () => {
    const res = await POST(makeRequest(`pay at ${CLONE} or ${LOOKALIKE}`));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(checkAnalyzeUrlReputation).toHaveBeenCalledWith(
      [CLONE, LOOKALIKE],
      expect.objectContaining({ source: "api/analyze" }),
    );
    expect(body.verdict).toBe("HIGH_RISK");
    expect(body.redFlags).toContain(`URL flagged by ${FIRST_PARTY_LABEL}: ${CLONE}`);
  });

  it("does not re-cite a first-party-flagged URL through the clone citation", async () => {
    await POST(makeRequest(`pay at ${CLONE} or ${LOOKALIKE}`));
    // Only the URL the first-party source did NOT flag is left for the citation.
    expect(lookupCloneAlert).toHaveBeenCalledWith([LOOKALIKE]);
  });

  it("skips the citation lookup entirely when every URL was a first-party hit", async () => {
    checkAnalyzeUrlReputation.mockResolvedValue([
      { url: CLONE, isMalicious: true, sources: [FIRST_PARTY_LABEL] },
      { url: LOOKALIKE, isMalicious: true, sources: ["Google Safe Browsing", FIRST_PARTY_LABEL] },
    ]);
    const res = await POST(makeRequest(`pay at ${CLONE} or ${LOOKALIKE}`));
    const body = await res.json();
    expect(lookupCloneAlert).not.toHaveBeenCalled();
    expect(body.redFlags.filter((f: string) => f.includes(CLONE))).toHaveLength(1);
  });

  it("still cites a confirmed-but-not-weaponised lookalike (red flag only, verdict unchanged by it)", async () => {
    checkAnalyzeUrlReputation.mockResolvedValue([
      { url: CLONE, isMalicious: false, sources: [] },
      { url: LOOKALIKE, isMalicious: false, sources: [] },
    ]);
    lookupCloneAlert.mockResolvedValue({
      candidateDomain: "revolut-help.xyz",
      impersonatedDomain: "revolut.com",
      firstFlaggedAt: "2026-09-01T00:00:00Z",
    });
    const res = await POST(makeRequest(`pay at ${CLONE} or ${LOOKALIKE}`));
    const body = await res.json();
    expect(lookupCloneAlert).toHaveBeenCalledWith([CLONE, LOOKALIKE]);
    expect(body.verdict).toBe("SAFE");
    expect(body.redFlags.some((f: string) => f.includes("clone-watch list"))).toBe(true);
  });
});
