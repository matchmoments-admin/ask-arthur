import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  runShopSignalEnrich,
  handleEnrichFailure,
} from "../shop-signal-enrich";
import { verifyShopAbnDeep } from "../../abn-extract";
import { getDomainCreatedDate } from "../../whois-cached";
import { getSiteTrustworthiness } from "../../providers/apivoid";
import { fetchShopPage } from "../../fetch-shop-page";
import { detectAndFetchReviews } from "../../providers/reviews";
import { assessReviewLanguage } from "../../providers/reviews/language";
import { isFeatureBraked } from "../../cost-log";
import { createServiceClient } from "@askarthur/supabase/server";

// featureFlags is a mutable mock object so a test can flip the paid feed
// or the reviews signal on; beforeEach resets all to OFF.
const { featureFlagsMock } = vi.hoisted(() => ({
  featureFlagsMock: {
    shopSignalPaidFeed: false,
    shopSignalReviews: false,
    shopSignalReviewsLlm: false,
  },
}));

// The enrichment adapters all do network I/O — mock them. The pure helpers
// (computeCompositeScore, domainAgeBand, extractDomain) run for real so the
// test exercises the genuine scoring path.
vi.mock("../../abn-extract", () => ({ verifyShopAbnDeep: vi.fn() }));
vi.mock("../../whois-cached", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../whois-cached")>()),
  getDomainCreatedDate: vi.fn(),
}));
vi.mock("../../providers/apivoid", () => ({
  getSiteTrustworthiness: vi.fn(),
}));
vi.mock("../../fetch-shop-page", () => ({ fetchShopPage: vi.fn() }));
vi.mock("../../providers/reviews", () => ({ detectAndFetchReviews: vi.fn() }));
vi.mock("../../providers/reviews/language", () => ({
  assessReviewLanguage: vi.fn(),
}));
vi.mock("../../cost-log", () => ({
  isFeatureBraked: vi.fn().mockResolvedValue(false),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: featureFlagsMock,
}));

const SHOP_CHECK_ID = "11111111-1111-4111-8111-111111111111";

// Pass-through step: runs each step body synchronously, exactly what an
// Inngest replay would converge to. Cast once — the runtime behaviour
// satisfies the EnrichStep contract.
const step = {
  run: async (_id: string, fn: () => unknown) => fn(),
} as unknown as Parameters<typeof runShopSignalEnrich>[0];

/** A fake Supabase client that records every rpc + insert call. */
function fakeSupabase() {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const client = { rpc, from: vi.fn(() => ({ insert })) };
  return { client, rpc, insert };
}

/** Mock the kouvrfashion shape: no ABN, unknown domain, implausible Okendo
 *  distribution (zero 1-star at scale). Score contributions before reviews:
 *  unknown domain (6) + no-abn (18) = 24. */
function mockImplausibleReviewsShop() {
  vi.mocked(verifyShopAbnDeep).mockResolvedValue({
    status: "no-abn",
    abn: null,
    entityName: null,
  });
  vi.mocked(getDomainCreatedDate).mockResolvedValue({
    createdDate: null,
    source: "live",
  });
  vi.mocked(fetchShopPage).mockResolvedValue({
    html: "<html>okendo</html>",
    finalUrl: "https://shop.example.com/",
    status: 200,
    error: null,
  });
  vi.mocked(detectAndFetchReviews).mockResolvedValue({
    app: "okendo",
    totalReviews: 748,
    averageRating: 4.8,
    distribution: { one: 0, two: 7, three: 15, four: 75, five: 651 },
    verifiedBuyerRatio: 1,
    reviews: [
      { rating: 5, text: "great", author: null, date: null, verified: true },
    ],
    fetchedFrom: "api.okendo.io",
  });
}

/** Find the write-back rpc call that carries the terminal `complete` patch. */
function completePatch(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.find(
    (c) =>
      c[0] === "update_shop_check_signal" &&
      (c[1] as { p_patch?: { deepCheck?: { status?: string } } }).p_patch
        ?.deepCheck?.status === "complete",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagsMock.shopSignalPaidFeed = false;
  featureFlagsMock.shopSignalReviews = false;
  featureFlagsMock.shopSignalReviewsLlm = false;
  vi.mocked(isFeatureBraked).mockResolvedValue(false);
});

describe("runShopSignalEnrich", () => {
  it("completes with a real composite score when all free signals resolve", async () => {
    vi.mocked(verifyShopAbnDeep).mockResolvedValue({
      status: "verified",
      abn: "12345678901",
      entityName: "Example Shop Pty Ltd",
    });
    vi.mocked(getDomainCreatedDate).mockResolvedValue({
      createdDate: "2018-03-01",
      source: "live",
    });
    const { client, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://shop.example.com/cart",
      commerceFlags: [],
    });

    // Established domain + verified ABN + no flags + no paid feed = 0.
    expect(result).toEqual({
      shopCheckId: SHOP_CHECK_ID,
      score: 0,
      band: "low-concern",
    });

    const written = completePatch(rpc);
    expect(written).toBeDefined();
    const args = written![1] as {
      p_composite_score: number;
      p_verdict: string;
      p_patch: { deepCheck: { status: string; band: string } };
    };
    expect(args.p_composite_score).toBe(0);
    expect(args.p_verdict).toBe("SAFE");
    expect(args.p_patch.deepCheck.band).toBe("low-concern");
  });

  it("still completes when every enrichment signal degrades", async () => {
    // ABN absent, WHOIS down — every adapter returns a graceful-degradation
    // value. The run must still reach a `complete` write-back, never throw.
    vi.mocked(verifyShopAbnDeep).mockResolvedValue({
      status: "no-abn",
      abn: null,
      entityName: null,
    });
    vi.mocked(getDomainCreatedDate).mockResolvedValue({
      createdDate: null,
      source: "live",
    });
    const { client, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://dodgy.example.com/checkout",
      commerceFlags: ["urgency-banner"],
    });

    // unknown domain age (6) + no-abn (18) + 1 flag (6) = 30 → some-concern.
    expect(result.score).toBe(30);
    expect(result.band).toBe("some-concern");

    const written = completePatch(rpc);
    expect(written).toBeDefined();
    expect(
      (written![1] as { p_patch: { deepCheck: { status: string } } }).p_patch
        .deepCheck.status,
    ).toBe("complete");
  });

  it("propagates a write-back RPC failure so Inngest retries", async () => {
    vi.mocked(verifyShopAbnDeep).mockResolvedValue({
      status: "not-applicable",
      abn: null,
      entityName: null,
    });
    vi.mocked(getDomainCreatedDate).mockResolvedValue({
      createdDate: null,
      source: "live",
    });
    // mark-processing succeeds; the terminal write-back fails.
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "deadlock" } });
    const client = { rpc, from: vi.fn(() => ({ insert: vi.fn() })) };
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await expect(
      runShopSignalEnrich(step, {
        shopCheckId: SHOP_CHECK_ID,
        url: "https://shop.example.com/",
        commerceFlags: [],
      }),
    ).rejects.toThrow(/update_shop_check_signal failed/);
  });

  it("writes no apivoid-error telemetry row when the paid call is brake-skipped", async () => {
    // A brake skip is the system working correctly — it must not look like
    // an APIVoid failure in the health digest (GitHub #349, F-B).
    featureFlagsMock.shopSignalPaidFeed = true;
    vi.mocked(verifyShopAbnDeep).mockResolvedValue({
      status: "not-applicable",
      abn: null,
      entityName: null,
    });
    vi.mocked(getDomainCreatedDate).mockResolvedValue({
      createdDate: "2015-01-01",
      source: "cache",
    });
    vi.mocked(getSiteTrustworthiness).mockResolvedValue({
      ok: false,
      reason: "brake",
    });
    const { client, insert } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://shop.example.com/cart",
      commerceFlags: [],
    });

    expect(insert).not.toHaveBeenCalled();
  });

  it("caps a stat-only implausible verdict at suspicious (LLM off)", async () => {
    // The kouvrfashion shape: no ABN + implausible reviews, LLM pass OFF.
    // Without AI confirmation the worst verdict is `suspicious`, never the
    // permanent `manipulated` mark.
    featureFlagsMock.shopSignalReviews = true;
    mockImplausibleReviewsShop();
    const { client, insert, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://shop.example.com/product",
      commerceFlags: [],
    });

    // unknown domain (6) + no-abn (18) + suspicious reviews (12) = 36.
    expect(result.score).toBe(36);
    expect(result.band).toBe("some-concern");
    // The LLM pass is off, so it must not be called.
    expect(assessReviewLanguage).not.toHaveBeenCalled();

    const written = completePatch(rpc);
    const deepCheck = (written![1] as {
      p_patch: { deepCheck: { reviews?: { verdict: string; app: string } } };
    }).p_patch.deepCheck;
    expect(deepCheck.reviews?.verdict).toBe("suspicious");
    expect(deepCheck.reviews?.app).toBe("okendo");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "shop_signal_reviews",
        estimated_cost_usd: 0,
      }),
    );
    // A concerning verdict is recorded in the durable per-domain registry
    // exactly once (extractDomain returns the registrable domain).
    const registryCalls = rpc.mock.calls.filter(
      (c) => c[0] === "upsert_shop_review_finding",
    );
    expect(registryCalls).toHaveLength(1);
    expect(registryCalls[0][1]).toMatchObject({
      p_domain: "example.com",
      p_review_app: "okendo",
      p_verdict: "suspicious",
    });
  });

  it("does not register a clean review verdict in the reputation registry", async () => {
    featureFlagsMock.shopSignalReviews = true;
    vi.mocked(verifyShopAbnDeep).mockResolvedValue({
      status: "not-applicable",
      abn: null,
      entityName: null,
    });
    vi.mocked(getDomainCreatedDate).mockResolvedValue({
      createdDate: "2015-01-01",
      source: "live",
    });
    vi.mocked(fetchShopPage).mockResolvedValue({
      html: "<html>okendo</html>",
      finalUrl: "https://legit.example.com/",
      status: 200,
      error: null,
    });
    // A small, healthy store: below every minimum-N floor → plausible → clean.
    vi.mocked(detectAndFetchReviews).mockResolvedValue({
      app: "okendo",
      totalReviews: 40,
      averageRating: 4.6,
      distribution: { one: 1, two: 1, three: 3, four: 10, five: 25 },
      verifiedBuyerRatio: 0.8,
      reviews: [{ rating: 5, text: "good", author: null, date: null, verified: true }],
      fetchedFrom: "api.okendo.io",
    });
    const { client, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://legit.example.com/p",
      commerceFlags: [],
    });

    const registryCalls = rpc.mock.calls.filter(
      (c) => c[0] === "upsert_shop_review_finding",
    );
    expect(registryCalls).toHaveLength(0);
  });

  it("lets the Claude language pass refute implausible stats down to suspicious", async () => {
    featureFlagsMock.shopSignalReviews = true;
    featureFlagsMock.shopSignalReviewsLlm = true;
    mockImplausibleReviewsShop();
    // The LLM reads the actual text and disagrees (looks genuine).
    vi.mocked(assessReviewLanguage).mockResolvedValue({
      fakeLikelihood: 0.1,
      reasons: ["reviews read genuine"],
      costUsd: 0.0002,
    });
    const { client, insert, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://shop.example.com/product",
      commerceFlags: [],
    });

    // Two-key fusion: implausible stats but LLM disagreement (0.1) → suspicious
    // (12), not manipulated (25). unknown (6) + no-abn (18) + suspicious (12) = 36.
    expect(result.score).toBe(36);
    const written = completePatch(rpc);
    const deepCheck = (written![1] as {
      p_patch: { deepCheck: { reviews?: { verdict: string } } };
    }).p_patch.deepCheck;
    expect(deepCheck.reviews?.verdict).toBe("suspicious");
    // The paid call's cost is logged under the anthropic provider.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "shop_signal_reviews",
        provider: "anthropic",
      }),
    );
  });

  it("skips the Claude pass when the reviews brake is engaged", async () => {
    featureFlagsMock.shopSignalReviews = true;
    featureFlagsMock.shopSignalReviewsLlm = true;
    vi.mocked(isFeatureBraked).mockResolvedValue(true);
    mockImplausibleReviewsShop();
    const { client, insert, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://shop.example.com/product",
      commerceFlags: [],
    });

    // Brake engaged → no Claude call → no AI confirmation → capped at
    // suspicious (12), not the permanent manipulated mark. 6+18+12=36.
    expect(assessReviewLanguage).not.toHaveBeenCalled();
    expect(result.score).toBe(36);
    const written = completePatch(rpc);
    expect(
      (written![1] as { p_patch: { deepCheck: { reviews?: { verdict: string } } } })
        .p_patch.deepCheck.reviews?.verdict,
    ).toBe("suspicious");
    // No anthropic cost row when the pass didn't run.
    expect(insert).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "anthropic" }),
    );
  });

  it("writes an apivoid-error telemetry row when the paid call genuinely fails", async () => {
    featureFlagsMock.shopSignalPaidFeed = true;
    vi.mocked(verifyShopAbnDeep).mockResolvedValue({
      status: "not-applicable",
      abn: null,
      entityName: null,
    });
    vi.mocked(getDomainCreatedDate).mockResolvedValue({
      createdDate: "2015-01-01",
      source: "cache",
    });
    vi.mocked(getSiteTrustworthiness).mockResolvedValue({
      ok: false,
      reason: "http-error",
    });
    const { client, insert } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await runShopSignalEnrich(step, {
      shopCheckId: SHOP_CHECK_ID,
      url: "https://shop.example.com/cart",
      commerceFlags: [],
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "shop-signal-apivoid-error" }),
    );
  });
});

describe("handleEnrichFailure", () => {
  it("marks the row terminally `error` and emits a digest-visible telemetry row", async () => {
    const { client, rpc, insert } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await handleEnrichFailure({
      data: {
        event: {
          data: {
            shopCheckId: SHOP_CHECK_ID,
            url: "https://shop.example.com/",
            commerceFlags: [],
          },
        },
      },
    });

    const errorWrite = rpc.mock.calls.find(
      (c) =>
        c[0] === "update_shop_check_signal" &&
        (c[1] as { p_patch?: { deepCheck?: { status?: string } } }).p_patch
          ?.deepCheck?.status === "error",
    );
    expect(errorWrite).toBeDefined();
    // A retry-exhausted run must land an `%error%`-tagged telemetry row so
    // the daily health digest surfaces it (GitHub #349, F4).
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "shop-signal-enrich-error" }),
    );
  });

  it("no-ops on a malformed failure event rather than throwing", async () => {
    const { client, rpc } = fakeSupabase();
    vi.mocked(createServiceClient).mockReturnValue(
      client as unknown as ReturnType<typeof createServiceClient>,
    );

    await expect(
      handleEnrichFailure({ data: { event: { data: { not: "valid" } } } }),
    ).resolves.toBeUndefined();
    expect(rpc).not.toHaveBeenCalled();
  });
});
