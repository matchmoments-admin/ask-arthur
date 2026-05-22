import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks must be staged before importing the module under test — the adapter
// imports createServiceClient + logger at top level.
const { maybeSingleMock, createServiceClientMock, loggerMock } = vi.hoisted(
  () => ({
    maybeSingleMock: vi.fn(),
    createServiceClientMock: vi.fn(),
    loggerMock: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  }),
);

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@askarthur/utils/logger", () => ({ logger: loggerMock }));

import {
  getSiteTrustworthiness,
  type ApivoidSiteTrust,
  type ApivoidSkip,
} from "../providers/apivoid";

// getSiteTrustworthiness returns a discriminated `ApivoidSiteTrust |
// ApivoidSkip`. asTrust narrows to the success member for the verdict
// tests, failing loudly if the call unexpectedly skipped.
function asTrust(out: ApivoidSiteTrust | ApivoidSkip): ApivoidSiteTrust {
  if ("ok" in out) {
    throw new Error(`expected a site-trust result, got skip: ${out.reason}`);
  }
  return out;
}

// A Supabase client mock that resolves the feature_brakes lookup chain:
// from("feature_brakes").select("paused_until").eq(...).maybeSingle()
function brakeClient() {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }),
      }),
    }),
  };
}

// A successful APIVoid v2 site-trust body — shape verified live 2026-05-20.
// trust_score.result + domain_blacklist.detections are top-level; the
// boolean checks live under security_checks.
function apivoidBody(
  overrides: {
    trust?: number;
    blacklistDetections?: number;
    checks?: Record<string, unknown>;
  } = {},
) {
  return {
    trust_score: { result: overrides.trust ?? 90 },
    domain_blacklist: {
      detections: overrides.blacklistDetections ?? 0,
      detection_rate: "0%",
    },
    security_checks: {
      is_domain_blacklisted: false,
      is_suspicious_domain: false,
      is_suspended_site: false,
      is_sinkholed_domain: false,
      is_most_abused_tld: false,
      is_ssl_expired: false,
      is_valid_https: true,
      is_email_spoofable: false,
      ...overrides.checks,
    },
    ecommerce_platform: { is_shopify: false, is_woocommerce: false },
  };
}

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.APIVOID_API_KEY = "test-key";
  maybeSingleMock.mockReset().mockResolvedValue({
    data: { paused_until: null },
    error: null,
  });
  createServiceClientMock.mockReset().mockReturnValue(brakeClient());
  loggerMock.info.mockClear();
  loggerMock.warn.mockClear();
  loggerMock.error.mockClear();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
});

describe("getSiteTrustworthiness — verdict mapping", () => {
  it("maps a high trust score with no risk markers to safe", async () => {
    fetchSpy.mockResolvedValue(okResponse(apivoidBody()));
    const out = asTrust(
      await getSiteTrustworthiness("https://legit-shop.com.au/cart"),
    );
    expect(out.paidProviderVerdict.provider).toBe("apivoid");
    expect(out.paidProviderVerdict.verdict).toBe("safe");
    expect(out.paidProviderVerdict.trustScore).toBe(90);
    expect(out.paidProviderVerdict.flags).toEqual([]);
    expect(out.units).toBe(10);
    expect(out.estimatedCostUsd).toBeCloseTo(0.0033);
    expect(new Date(out.paidProviderVerdict.checkedAt).toISOString()).toBe(
      out.paidProviderVerdict.checkedAt,
    );
  });

  it("maps a blacklisted domain to risky regardless of trust score", async () => {
    fetchSpy.mockResolvedValue(
      okResponse(apivoidBody({ trust: 95, checks: { is_domain_blacklisted: true } })),
    );
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.verdict).toBe("risky");
    expect(out.paidProviderVerdict.flags).toContain("domain-blacklisted");
  });

  it("maps blacklist detections > 0 to risky", async () => {
    fetchSpy.mockResolvedValue(okResponse(apivoidBody({ blacklistDetections: 3 })));
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.verdict).toBe("risky");
    expect(out.paidProviderVerdict.blacklistDetections).toBe(3);
    expect(out.paidProviderVerdict.flags).toContain("domain-blacklisted");
  });

  it("maps a low trust score to risky", async () => {
    fetchSpy.mockResolvedValue(okResponse(apivoidBody({ trust: 20 })));
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.verdict).toBe("risky");
  });

  it("maps a mid trust score to suspicious", async () => {
    fetchSpy.mockResolvedValue(okResponse(apivoidBody({ trust: 50 })));
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.verdict).toBe("suspicious");
  });

  it("maps a suspended site to suspicious even with a good score", async () => {
    fetchSpy.mockResolvedValue(
      okResponse(apivoidBody({ trust: 85, checks: { is_suspended_site: true } })),
    );
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.verdict).toBe("suspicious");
    expect(out.paidProviderVerdict.flags).toContain("suspended-site");
  });

  it("maps a sinkholed domain to suspicious", async () => {
    fetchSpy.mockResolvedValue(
      okResponse(apivoidBody({ trust: 80, checks: { is_sinkholed_domain: true } })),
    );
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.verdict).toBe("suspicious");
    expect(out.paidProviderVerdict.flags).toContain("sinkholed-domain");
  });

  it("collects all risk-marker flags from security_checks", async () => {
    fetchSpy.mockResolvedValue(
      okResponse(
        apivoidBody({
          trust: 40,
          checks: {
            is_suspicious_domain: true,
            is_most_abused_tld: true,
            is_ssl_expired: true,
            is_valid_https: false,
            is_email_spoofable: true,
          },
        }),
      ),
    );
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.flags).toEqual(
      expect.arrayContaining([
        "suspicious-domain",
        "high-risk-tld",
        "ssl-expired",
        "no-valid-https",
        "email-spoofable",
      ]),
    );
  });

  it("degrades a missing trust score to a safe-side default (no throw)", async () => {
    fetchSpy.mockResolvedValue(okResponse({}));
    const out = asTrust(await getSiteTrustworthiness("https://x.shop"));
    expect(out.paidProviderVerdict.trustScore).toBe(50);
    expect(out.paidProviderVerdict.verdict).toBe("suspicious");
    expect(out.paidProviderVerdict.flags).toEqual([]);
  });
});

describe("getSiteTrustworthiness — request shape", () => {
  it("sends host-only (extracted from the URL) with the API key header", async () => {
    fetchSpy.mockResolvedValue(okResponse(apivoidBody()));
    await getSiteTrustworthiness("https://Designer-Bags.SHOP/cart?ref=x");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.apivoid.com/v2/site-trust");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(init.body as string)).toEqual({ host: "designer-bags.shop" });
  });

  it("accepts a bare host without a protocol", async () => {
    fetchSpy.mockResolvedValue(okResponse(apivoidBody()));
    await getSiteTrustworthiness("bag-outlet.shop");
    expect(JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string)).toEqual({
      host: "bag-outlet.shop",
    });
  });
});

describe("getSiteTrustworthiness — graceful degradation returns a discriminated skip", () => {
  it("returns no-key and skips the call when the API key is missing", async () => {
    delete process.env.APIVOID_API_KEY;
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "no-key" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns bad-host and skips the call when the host cannot be parsed", async () => {
    const out = await getSiteTrustworthiness("not a url");
    expect(out).toEqual({ ok: false, reason: "bad-host" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns brake and skips the call when the cost brake is engaged", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { paused_until: new Date(Date.now() + 3_600_000).toISOString() },
      error: null,
    });
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "brake" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proceeds with the call when paused_until is in the past", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { paused_until: new Date(Date.now() - 3_600_000).toISOString() },
      error: null,
    });
    fetchSpy.mockResolvedValue(okResponse(apivoidBody()));
    const out = await getSiteTrustworthiness("https://x.shop");
    expect("ok" in out).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns brake when there is no Supabase client (brake unverifiable)", async () => {
    createServiceClientMock.mockReturnValue(null);
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "brake" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns brake when the brake lookup errors", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "db down" } });
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "brake" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns http-error on an HTTP error response", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500 } as unknown as Response);
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "http-error" });
  });

  it("returns timeout when fetch aborts on the timeout signal", async () => {
    fetchSpy.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "timeout" });
  });

  it("returns http-error when fetch throws a non-timeout network error", async () => {
    fetchSpy.mockRejectedValue(new TypeError("network error"));
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "http-error" });
  });

  it("returns http-error when the response body is not valid JSON", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);
    const out = await getSiteTrustworthiness("https://x.shop");
    expect(out).toEqual({ ok: false, reason: "http-error" });
  });
});
