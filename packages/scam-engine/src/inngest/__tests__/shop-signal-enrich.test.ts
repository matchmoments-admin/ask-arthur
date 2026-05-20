import { describe, expect, it, vi, beforeEach } from "vitest";

import { runShopSignalEnrich } from "../shop-signal-enrich";
import { fetchShopPage } from "../../fetch-shop-page";
import { verifyShopAbn } from "../../abn-extract";
import { getDomainCreatedDate } from "../../whois-cached";
import { createServiceClient } from "@askarthur/supabase/server";

// The enrichment adapters all do network I/O — mock them. The pure helpers
// (computeCompositeScore, domainAgeBand, extractDomain) run for real so the
// test exercises the genuine scoring path.
vi.mock("../../fetch-shop-page", () => ({ fetchShopPage: vi.fn() }));
vi.mock("../../abn-extract", () => ({ verifyShopAbn: vi.fn() }));
vi.mock("../../whois-cached", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../whois-cached")>()),
  getDomainCreatedDate: vi.fn(),
}));
vi.mock("../../providers/apivoid", () => ({
  getSiteTrustworthiness: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
// Paid feed OFF — the deep check must complete on ABN + domain-age alone.
vi.mock("@askarthur/utils/feature-flags", () => ({
  featureFlags: { shopSignalPaidFeed: false },
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
});

describe("runShopSignalEnrich", () => {
  it("completes with a real composite score when all free signals resolve", async () => {
    vi.mocked(fetchShopPage).mockResolvedValue({
      html: "<html>ABN 12 345 678 901</html>",
      finalUrl: "https://shop.example.com/",
      status: 200,
      error: null,
    });
    vi.mocked(verifyShopAbn).mockResolvedValue({
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
    // Page fetch blocked, ABN unknowable, WHOIS down — every adapter
    // returns its graceful-degradation value. The run must still reach a
    // `complete` write-back, never throw.
    vi.mocked(fetchShopPage).mockResolvedValue({
      html: null,
      finalUrl: null,
      status: null,
      error: "timeout",
    });
    vi.mocked(verifyShopAbn).mockResolvedValue({
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
    vi.mocked(fetchShopPage).mockResolvedValue({
      html: null,
      finalUrl: null,
      status: null,
      error: "network-error",
    });
    vi.mocked(verifyShopAbn).mockResolvedValue({
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
});
