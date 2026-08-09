import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: rpcMock }),
}));

// Mutable so tests can toggle FF_BRAND_DYNAMIC_WATCHLIST; the module reads the
// property live at call time.
const flags = { brandDynamicWatchlist: true };
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Dynamic import: the vi.mock factories above are hoisted, so a STATIC import
// of the module under test would evaluate them before `flags` exists
// ("Cannot access 'flags' before initialization"). Same pattern as
// asic-lookup.test.ts.
type Mod = typeof import("../active-watchlist");
let mod: Mod;

import type { BrandEntry } from "@askarthur/shopfront-glue";

const STATIC: BrandEntry[] = [
  { brand: "Bunnings", legitimate_domains: ["bunnings.com.au"] },
];

const OVERLAY_ROW = {
  brand: "Pilot Co",
  legitimate_domains: ["pilotco.com.au"],
  aliases: ["PilotCo"],
};

beforeEach(async () => {
  rpcMock.mockReset();
  flags.brandDynamicWatchlist = true;
  mod = await import("../active-watchlist");
  // Module state persists across imports, so each case starts from a cold
  // cache explicitly rather than relying on import order.
  mod.invalidateActiveWatchlistCache();
});

const getActiveWatchlist: Mod["getActiveWatchlist"] = (...a) =>
  mod.getActiveWatchlist(...a);
const getActiveWatchlistDetailed: Mod["getActiveWatchlistDetailed"] = (...a) =>
  mod.getActiveWatchlistDetailed(...a);
const invalidateActiveWatchlistCache = () =>
  mod.invalidateActiveWatchlistCache();

describe("getActiveWatchlist — fail-safe behaviour", () => {
  it("never queries the database when the flag is off", async () => {
    flags.brandDynamicWatchlist = false;
    const list = await getActiveWatchlist(STATIC);
    expect(list).toEqual(STATIC);
    // The whole reason the checkout hot path is safe today.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("falls back to the static list when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const list = await getActiveWatchlist(STATIC);
    // Degraded, not empty — an overlay that fails to load must never be able
    // to silently SHRINK the watchlist.
    expect(list).toEqual(STATIC);
  });

  it("falls back to the static list when the overlay is empty", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    expect(await getActiveWatchlist(STATIC)).toEqual(STATIC);
  });

  it("merges overlay brands on top of the static list", async () => {
    rpcMock.mockResolvedValue({ data: [OVERLAY_ROW], error: null });
    const r = await getActiveWatchlistDetailed(STATIC);
    expect(r.dynamicCount).toBe(1);
    expect(r.entries.map((e) => e.brand)).toEqual(["Bunnings", "Pilot Co"]);
  });

  it("rejects an overlay brand with no domains rather than merging it", async () => {
    rpcMock.mockResolvedValue({
      data: [{ brand: "Ghost", legitimate_domains: [] }],
      error: null,
    });
    const r = await getActiveWatchlistDetailed(STATIC);
    expect(r.entries).toEqual(STATIC);
    expect(r.rejected).toEqual([{ brand: "Ghost", reason: "no_domains" }]);
  });
});

describe("overlay caching", () => {
  it("queries once and serves subsequent reads from cache", async () => {
    rpcMock.mockResolvedValue({ data: [OVERLAY_ROW], error: null });
    await getActiveWatchlist(STATIC);
    await getActiveWatchlist(STATIC);
    await getActiveWatchlist(STATIC);
    // This is the point of the change: analyze-checkout calls this per
    // request, on a route whose stated design premise is low latency.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failed read — the next call retries", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "blip" } });
    expect(await getActiveWatchlist(STATIC)).toEqual(STATIC);

    rpcMock.mockResolvedValueOnce({ data: [OVERLAY_ROW], error: null });
    const recovered = await getActiveWatchlist(STATIC);
    // A transient error must not pin the static list for the whole TTL.
    expect(recovered.map((e) => e.brand)).toContain("Pilot Co");
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("caches a successful EMPTY read (the current steady state)", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getActiveWatchlist(STATIC);
    await getActiveWatchlist(STATIC);
    // Zero rows is a successful answer, not a failure — don't re-query it.
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight query between concurrent callers", async () => {
    let release: (v: unknown) => void = () => {};
    rpcMock.mockReturnValue(
      new Promise((res) => {
        release = res;
      }),
    );
    const all = Promise.all([
      getActiveWatchlist(STATIC),
      getActiveWatchlist(STATIC),
      getActiveWatchlist(STATIC),
    ]);
    release({ data: [OVERLAY_ROW], error: null });
    const results = await all;
    // Single-flight: a warming instance must not stampede the RPC.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    for (const r of results)
      expect(r.map((e) => e.brand)).toContain("Pilot Co");
  });

  it("re-queries after an explicit invalidation", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await getActiveWatchlist(STATIC);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    // What promote/demote call, so a promotion is live immediately rather than
    // up to a TTL later. An undo that takes a minute is not an undo.
    invalidateActiveWatchlistCache();
    rpcMock.mockResolvedValue({ data: [OVERLAY_ROW], error: null });
    const after = await getActiveWatchlist(STATIC);
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(after.map((e) => e.brand)).toContain("Pilot Co");
  });

  it("caches the overlay rows, not the merged list, so staticList stays honest", async () => {
    rpcMock.mockResolvedValue({ data: [OVERLAY_ROW], error: null });
    const first = await getActiveWatchlist(STATIC);
    expect(first.map((e) => e.brand)).toEqual(["Bunnings", "Pilot Co"]);

    // Same cached overlay, DIFFERENT static list. Had the merged result been
    // cached, this caller would be served the other caller's watchlist.
    const otherStatic: BrandEntry[] = [
      { brand: "Coles", legitimate_domains: ["coles.com.au"] },
    ];
    const second = await getActiveWatchlist(otherStatic);
    expect(second.map((e) => e.brand)).toEqual(["Coles", "Pilot Co"]);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("does not consult the cache at all while the flag is off", async () => {
    rpcMock.mockResolvedValue({ data: [OVERLAY_ROW], error: null });
    await getActiveWatchlist(STATIC); // populates the cache

    flags.brandDynamicWatchlist = false;
    expect(await getActiveWatchlist(STATIC)).toEqual(STATIC);
  });
});
