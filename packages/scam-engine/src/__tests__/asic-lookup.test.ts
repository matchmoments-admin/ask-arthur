import { describe, it, expect, beforeEach, vi } from "vitest";

// Pre-stage mocks BEFORE the dynamic import so the module under test picks them
// up at evaluation time.
const rpcMock = vi.fn();
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({ rpc: rpcMock }),
}));

// Mutable flag object so tests can toggle FF_ASIC_LOOKUP; the module reads the
// property live at call time.
const flags = { asicLookup: true };
vi.mock("@askarthur/utils/feature-flags", () => ({ featureFlags: flags }));

vi.mock("@askarthur/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@askarthur/utils/axiom-logger", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    flush: async () => {},
  }),
}));
vi.mock("../cost-log", () => ({ logCost: vi.fn() }));

async function importFresh() {
  return await import("../asic-lookup");
}

const HIT_ROW = {
  id: 1,
  entity_name: "Tag Markets Pty Ltd",
  alert_type: "imposter",
  asic_url: "https://asic.example/tagmarkets",
  domains: ["tagmarkets.com"],
  match_type: "domain",
  is_active: true,
};

function baseResult() {
  return { verdict: "SAFE", redFlags: ["existing flag"], nextSteps: [] } as never;
}

describe("checkAsicListed", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    flags.asicLookup = true;
    vi.resetModules();
  });

  it("returns null for an empty/blank query without calling the RPC", async () => {
    const { checkAsicListed } = await importFresh();
    expect(await checkAsicListed("   ")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns a citation on an RPC hit", async () => {
    rpcMock.mockResolvedValue({ data: [HIT_ROW], error: null });
    const { checkAsicListed } = await importFresh();
    expect(await checkAsicListed("https://tagmarkets.com/join")).toEqual({
      entityName: "Tag Markets Pty Ltd",
      alertType: "imposter",
      asicUrl: "https://asic.example/tagmarkets",
      matchType: "domain",
    });
  });

  it("prefers an active row over an inactive one", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { ...HIT_ROW, id: 2, entity_name: "Old Delisted", is_active: false },
        HIT_ROW,
      ],
      error: null,
    });
    const { checkAsicListed } = await importFresh();
    const hit = await checkAsicListed("tagmarkets");
    expect(hit?.entityName).toBe("Tag Markets Pty Ltd");
  });

  it("returns null on an empty RPC result set", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { checkAsicListed } = await importFresh();
    expect(await checkAsicListed("nothing here")).toBeNull();
  });

  it("never throws on an RPC error field — yields null", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { checkAsicListed } = await importFresh();
    expect(await checkAsicListed("x")).toBeNull();
  });

  it("never throws when the RPC promise REJECTS — yields null", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const { checkAsicListed } = await importFresh();
    await expect(checkAsicListed("https://tagmarkets.com")).resolves.toBeNull();
  });
});

describe("applyAsicCitation", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    flags.asicLookup = true;
    vi.resetModules();
  });

  it("is a no-op returning null when the flag is OFF (no RPC call)", async () => {
    flags.asicLookup = false;
    rpcMock.mockResolvedValue({ data: [HIT_ROW], error: null });
    const { applyAsicCitation } = await importFresh();
    const result = baseResult();
    expect(await applyAsicCitation(result, "https://tagmarkets.com")).toBeNull();
    expect(rpcMock).not.toHaveBeenCalled();
    expect((result as { redFlags: string[] }).redFlags).toEqual(["existing flag"]);
  });

  it("appends an ASIC red flag on a hit (preserving existing flags)", async () => {
    rpcMock.mockResolvedValue({ data: [HIT_ROW], error: null });
    const { applyAsicCitation } = await importFresh();
    const result = baseResult();
    const hit = await applyAsicCitation(result, "https://tagmarkets.com");
    expect(hit?.entityName).toBe("Tag Markets Pty Ltd");
    const flagsOut = (result as { redFlags: string[] }).redFlags;
    expect(flagsOut).toHaveLength(2);
    expect(flagsOut[0]).toBe("existing flag");
    expect(flagsOut[1]).toContain("ASIC has flagged");
    expect(flagsOut[1]).toContain("Tag Markets Pty Ltd");
  });

  it("leaves redFlags unchanged when there is no hit", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    const { applyAsicCitation } = await importFresh();
    const result = baseResult();
    expect(await applyAsicCitation(result, "clean text")).toBeNull();
    expect((result as { redFlags: string[] }).redFlags).toEqual(["existing flag"]);
  });

  it("never throws + leaves redFlags unchanged when the RPC rejects", async () => {
    rpcMock.mockRejectedValue(new Error("network down"));
    const { applyAsicCitation } = await importFresh();
    const result = baseResult();
    await expect(
      applyAsicCitation(result, "https://tagmarkets.com"),
    ).resolves.toBeNull();
    expect((result as { redFlags: string[] }).redFlags).toEqual(["existing flag"]);
  });
});
