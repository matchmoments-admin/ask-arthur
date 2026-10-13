import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@askarthur/scam-engine/inngest/client", () => ({
  inngest: { createFunction: vi.fn(() => ({})), send },
}));
vi.mock("@askarthur/scam-engine/inngest/with-axiom-logging", () => ({
  withAxiomLogging: (_: unknown, fn: unknown) => fn,
}));
vi.mock("@askarthur/scam-engine/active-watchlist", () => ({
  getActiveWatchlistDetailed: vi.fn(),
}));
vi.mock("@askarthur/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({ sendAdminTelegramMessage: vi.fn() }));
vi.mock("@/app/api/inngest/functions/report-brand-stewardship", () => ({
  deriveBrandKey: (b: string) => b.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase(),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { seedKnownBrandForSubscriber } from "@/lib/clone-watch/known-brand-seed";

// #1304: the seed Module calls v348 and asks for ONE discover probe only when
// it created an unprobed row. Never throws (the activation already happened).
// Go-red (2026-10-13): with the `outcome === "created"` guard removed, "an
// existing row needs no probe" failed (an event per activation of a brand
// known_brands already had).

type Rpc = ReturnType<typeof vi.fn>;
function client(rpcResult: { data: unknown; error: { message: string } | null }, brandName = "Acme Bank") {
  const rpc: Rpc = vi.fn(async () => rpcResult);
  const sb = {
    rpc,
    from: vi.fn(() => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: { brand_name: brandName }, error: null });
      return b;
    }),
  };
  return { sb: sb as never, rpc };
}

beforeEach(() => {
  send.mockReset();
});

describe("seedKnownBrandForSubscriber", () => {
  it("created → one discover event, keyed per subscriber (a replayed webhook is de-duplicated)", async () => {
    const { sb, rpc } = client({ data: [{ known_brand_id: 5, outcome: "created" }], error: null });
    const out = await seedKnownBrandForSubscriber(sb, { brandSubscriberId: 42, brandName: "Acme Bank", brandCategory: "bank" });
    expect(out).toEqual({ outcome: "created", knownBrandId: 5, probeRequested: true });
    expect(rpc).toHaveBeenCalledWith("seed_known_brand_for_subscriber", {
      p_brand_subscriber_id: 42,
      p_brand_key: "acme_bank",
      p_brand_category: "bank",
    });
    expect(send).toHaveBeenCalledWith({
      id: "known-brand-seed-42",
      name: "known-brands/discover.manual-trigger.v1",
      data: { reason: "brand_subscriber_activated", brandSubscriberId: 42 },
    });
  });

  it("an existing row needs no probe", async () => {
    const { sb } = client({ data: [{ known_brand_id: 3, outcome: "existing_category_set" }], error: null });
    const out = await seedKnownBrandForSubscriber(sb, { brandSubscriberId: 42, brandName: "Acme Bank" });
    expect(out.probeRequested).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("reads the brand name from the row when the caller lacks it (the webhook)", async () => {
    const { sb, rpc } = client({ data: [{ known_brand_id: 5, outcome: "created" }], error: null }, "Webhook Brand");
    await seedKnownBrandForSubscriber(sb, { brandSubscriberId: 7 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_brand_key: "webhook_brand", p_brand_category: null });
  });

  it("never throws: an RPC error or a failed event send is an outcome, not an exception", async () => {
    const { sb } = client({ data: null, error: { message: "boom" } });
    await expect(seedKnownBrandForSubscriber(sb, { brandSubscriberId: 1, brandName: "X Co" })).resolves.toEqual({
      outcome: "failed",
      knownBrandId: null,
      probeRequested: false,
    });

    const throwing = { rpc: vi.fn(async () => { throw new Error("socket hang up"); }), from: vi.fn() };
    await expect(seedKnownBrandForSubscriber(throwing as never, { brandSubscriberId: 3, brandName: "X Co" })).resolves.toMatchObject({
      outcome: "failed",
    });

    send.mockRejectedValueOnce(new Error("inngest down"));
    const ok = client({ data: [{ known_brand_id: 5, outcome: "created" }], error: null });
    await expect(seedKnownBrandForSubscriber(ok.sb, { brandSubscriberId: 2, brandName: "X Co" })).resolves.toMatchObject({
      outcome: "created",
      probeRequested: false,
    });
  });
});
