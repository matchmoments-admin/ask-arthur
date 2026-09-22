import { describe, it, expect, beforeEach, vi } from "vitest";
import { mergeVerdict } from "@askarthur/core-analysis";

// ── Supabase query-builder mock ──
// Records every chained call so the tests can assert the exact gate the query
// applies (the source gate is the load-bearing guard — see module header).
const calls: Array<[string, unknown[]]> = [];
let queryResult: Promise<{ data: unknown; error: { message: string } | null }> =
  Promise.resolve({ data: [], error: null });
let createThrows = false;

function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["from", "select", "in", "eq", "overlaps", "limit"]) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    queryResult.then(res, rej);
  return b;
}

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => {
    if (createThrows) throw new Error("client exploded");
    return builder();
  },
}));

const flags = { analyzeFirstPartyUrls: true };
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
const axiomWarn = vi.fn();
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: axiomWarn,
    error: vi.fn(),
    flush: async () => {},
  }),
}));
const logCost = vi.fn();
vi.mock("../cost-log", () => ({ logCost: (...a: unknown[]) => logCost(...a) }));
const checkURLReputation = vi.fn();
vi.mock("../safebrowsing", () => ({
  checkURLReputation: (...a: unknown[]) => checkURLReputation(...a),
}));

const {
  firstPartyLookupKeys,
  checkFirstPartyUrlReputation,
  mergeUrlReputation,
  checkAnalyzeUrlReputation,
  isFirstPartySource,
  FIRST_PARTY_VERIFIED_SOURCES,
} = await import("../first-party-url-reputation");

const CLONE_ROW = {
  normalized_url: "https://coinbase-transaction.shop/",
  brand_impersonated: "coinbase.com",
  feed_sources: ["clone_watch"],
};

function callArgs(method: string, column?: string): unknown[] | undefined {
  return calls.find(([m, a]) => m === method && (column === undefined || a[0] === column))?.[1];
}

beforeEach(() => {
  calls.length = 0;
  queryResult = Promise.resolve({ data: [], error: null });
  createThrows = false;
  flags.analyzeFirstPartyUrls = true;
  logCost.mockReset();
  axiomWarn.mockReset();
  checkURLReputation.mockReset();
  checkURLReputation.mockResolvedValue([]);
});

describe("firstPartyLookupKeys", () => {
  it("covers the exact URL and the host root, www-stripped, both schemes", () => {
    const keys = firstPartyLookupKeys(
      "https://WWW.Coinbase-Transaction.shop/login?utm_source=sms",
    );
    expect(keys).toContain("https://www.coinbase-transaction.shop/login");
    expect(keys).toContain("https://coinbase-transaction.shop/");
    expect(keys).toContain("http://coinbase-transaction.shop/");
    expect(keys).toContain("https://www.coinbase-transaction.shop/");
  });

  it("walks ancestor hosts down to the registrable domain", () => {
    const keys = firstPartyLookupKeys("https://secure.login.evil-bank.com.au/x");
    expect(keys).toContain("https://login.evil-bank.com.au/");
    expect(keys).toContain("https://evil-bank.com.au/");
  });

  it("never probes a public suffix", () => {
    const keys = firstPartyLookupKeys("https://a.b.evil-bank.com.au/");
    expect(keys).not.toContain("https://com.au/");
    expect(keys).not.toContain("https://au/");
    expect(keys.some((k) => k.startsWith("https://com.au"))).toBe(false);
  });

  it("returns [] for non-http(s) input", () => {
    expect(firstPartyLookupKeys("ftp://evil.shop/")).toEqual([]);
    expect(firstPartyLookupKeys("not a url")).toEqual([]);
  });
});

describe("checkFirstPartyUrlReputation", () => {
  it("flags a submitted URL whose host root is a clone_watch row, citing the brand", async () => {
    queryResult = Promise.resolve({ data: [CLONE_ROW], error: null });
    const out = await checkFirstPartyUrlReputation([
      "https://coinbase-transaction.shop/verify?id=1",
      "https://example.org/",
    ]);
    expect(out).toEqual([
      {
        url: "https://coinbase-transaction.shop/verify?id=1",
        isMalicious: true,
        sources: ["Ask Arthur Clone Watch (live impersonation of coinbase.com)"],
      },
    ]);
    expect(out[0].sources.every(isFirstPartySource)).toBe(true);
    // Rare high-value event → always-ship Axiom warn.
    expect(axiomWarn).toHaveBeenCalledWith(
      "first_party_url_hit",
      expect.objectContaining({ hits: 1 }),
    );
  });

  it("gates the query on active, high/confirmed rows from a VERIFIED first-party source", async () => {
    await checkFirstPartyUrlReputation(["https://coinbase-transaction.shop/"]);
    expect(callArgs("from")).toEqual(["scam_urls"]);
    expect(callArgs("in", "normalized_url")?.[1]).toContain("https://coinbase-transaction.shop/");
    expect(callArgs("eq", "is_active")).toEqual(["is_active", true]);
    expect(callArgs("in", "confidence_level")).toEqual(["confidence_level", ["high", "confirmed"]]);
    // The source gate: user-report-driven 'high' rows (4 unique reporters reach
    // 0.65) must never escalate a verdict — only named machine-verified sources.
    expect(callArgs("overlaps", "feed_sources")).toEqual(["feed_sources", ["clone_watch"]]);
    expect(FIRST_PARTY_VERIFIED_SOURCES).toEqual(["clone_watch"]);
  });

  it("ignores a returned row that carries no verified source (defence in depth)", async () => {
    queryResult = Promise.resolve({
      data: [{ ...CLONE_ROW, feed_sources: ["user_report_only"] }],
      error: null,
    });
    expect(await checkFirstPartyUrlReputation(["https://coinbase-transaction.shop/"])).toEqual([]);
  });

  it("fails open on a query error and pages via a $0 error row", async () => {
    queryResult = Promise.resolve({ data: null, error: { message: "boom" } });
    expect(await checkFirstPartyUrlReputation(["https://coinbase-transaction.shop/"])).toEqual([]);
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "first-party-url-reputation-error",
        estimatedCostUsd: 0,
      }),
    );
  });

  it("fails open when the client throws", async () => {
    createThrows = true;
    expect(await checkFirstPartyUrlReputation(["https://coinbase-transaction.shop/"])).toEqual([]);
    expect(logCost).toHaveBeenCalledTimes(1);
  });

  it("fails open on a rejected query", async () => {
    queryResult = Promise.reject(new Error("network down"));
    expect(await checkFirstPartyUrlReputation(["https://coinbase-transaction.shop/"])).toEqual([]);
  });

  it("gives up after the timeout instead of holding the request", async () => {
    queryResult = new Promise(() => {}); // never settles
    const started = Date.now();
    const out = await checkFirstPartyUrlReputation(["https://coinbase-transaction.shop/"], {
      timeoutMs: 30,
    });
    expect(out).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { error: "timed out after 30ms" } }),
    );
  });

  it("does not query at all when there is nothing to look up", async () => {
    expect(await checkFirstPartyUrlReputation(["mailto:x@y.z"])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("mergeUrlReputation", () => {
  it("unions sources per URL and ORs isMalicious", () => {
    const merged = mergeUrlReputation(
      [
        { url: "https://a.shop/", isMalicious: false, sources: [] },
        { url: "https://b.shop/", isMalicious: true, sources: ["Google Safe Browsing"] },
      ],
      [
        { url: "https://a.shop/", isMalicious: true, sources: ["Ask Arthur Clone Watch (x)"] },
        { url: "https://b.shop/", isMalicious: true, sources: ["Ask Arthur Clone Watch (y)"] },
      ],
    );
    expect(merged).toEqual([
      { url: "https://a.shop/", isMalicious: true, sources: ["Ask Arthur Clone Watch (x)"] },
      {
        url: "https://b.shop/",
        isMalicious: true,
        sources: ["Google Safe Browsing", "Ask Arthur Clone Watch (y)"],
      },
    ]);
  });
});

describe("checkAnalyzeUrlReputation", () => {
  const URL = "https://coinbase-transaction.shop/verify";

  it("flag OFF: GSB/VT only, no first-party query", async () => {
    flags.analyzeFirstPartyUrls = false;
    checkURLReputation.mockResolvedValue([{ url: URL, isMalicious: false, sources: [] }]);
    expect(await checkAnalyzeUrlReputation([URL])).toEqual([
      { url: URL, isMalicious: false, sources: [] },
    ]);
    expect(calls).toHaveLength(0);
  });

  it("flag ON: a first-party hit escalates to HIGH_RISK through mergeVerdict exactly like a GSB hit", async () => {
    queryResult = Promise.resolve({ data: [CLONE_ROW], error: null });
    checkURLReputation.mockResolvedValue([{ url: URL, isMalicious: false, sources: [] }]);
    const urlResults = await checkAnalyzeUrlReputation([URL]);

    const ai = { verdict: "SAFE" as const, confidence: 0.8, summary: "ok", redFlags: [], nextSteps: [] };
    const firstParty = mergeVerdict({ ai, urlResults });
    const gsb = mergeVerdict({
      ai,
      urlResults: [{ url: URL, isMalicious: true, sources: ["Google Safe Browsing"] }],
    });

    expect(firstParty.verdict).toBe("HIGH_RISK");
    expect(firstParty.verdict).toBe(gsb.verdict);
    expect(firstParty.nextSteps).toEqual(gsb.nextSteps);
    expect(firstParty.signals.maliciousUrlCount).toBe(1);
    expect(firstParty.redFlags).toEqual([
      `URL flagged by Ask Arthur Clone Watch (live impersonation of coinbase.com): ${URL}`,
    ]);
  });

  it("flag ON: a first-party failure leaves the GSB/VT result intact", async () => {
    queryResult = Promise.resolve({ data: null, error: { message: "boom" } });
    const gsbHit = [{ url: URL, isMalicious: true, sources: ["Google Safe Browsing"] }];
    checkURLReputation.mockResolvedValue(gsbHit);
    expect(await checkAnalyzeUrlReputation([URL])).toEqual(gsbHit);
  });

  it("returns [] without any lookup for no URLs", async () => {
    expect(await checkAnalyzeUrlReputation([])).toEqual([]);
    expect(checkURLReputation).not.toHaveBeenCalled();
  });
});
