import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoist mocks so the factory captures them at module-load.
const { createServiceClientMock, embedQueryMock, loggerMock } = vi.hoisted(() => ({
  createServiceClientMock: vi.fn(),
  embedQueryMock: vi.fn(),
  loggerMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => createServiceClientMock(),
}));

vi.mock("@askarthur/utils/logger", () => ({ logger: loggerMock }));

vi.mock("@askarthur/scam-engine/embeddings", () => ({
  embedQuery: () => embedQueryMock(),
}));

import { acncProvider } from "../providers/acnc";
import type { CharityCheckInput, CharityPillarResult } from "../types";

// acncProvider.run is typed as returning either a single result or an array,
// but the implementation always returns a single result. Narrow for the test.
async function runAcnc(input: CharityCheckInput): Promise<CharityPillarResult> {
  const r = await acncProvider.run(input);
  if (Array.isArray(r)) {
    throw new Error("acncProvider unexpectedly returned an array");
  }
  return r;
}

interface MaybeSingleResult {
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}

function makeAbnPathClient(result: MaybeSingleResult) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue(result),
        })),
      })),
    })),
    rpc: vi.fn(),
  };
}

function makeNamePathClient(trigramRows: Record<string, unknown>[]) {
  return {
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({ data: trigramRows, error: null }),
  };
}

beforeEach(() => {
  createServiceClientMock.mockReset();
  embedQueryMock.mockReset();
  Object.values(loggerMock).forEach((m) => m.mockReset?.());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("acncProvider — ABN path delistment", () => {
  it("active charity: registered=true, score=0", async () => {
    createServiceClientMock.mockReturnValue(
      makeAbnPathClient({
        data: {
          abn: "11005357522",
          charity_legal_name: "Australian Red Cross Society",
          charity_website: "https://redcross.org.au",
          town_city: "Canberra",
          state: "ACT",
          postcode: "2600",
          charity_size: "Large",
          registration_date: "2014-12-03",
          is_pbi: true,
          is_hpc: false,
          operates_in_states: ["ACT", "NSW"],
          is_delisted: false,
          delisted_at: null,
        },
        error: null,
      }),
    );

    const result = await runAcnc({
      abn: "11005357522",
      // no name
      // no website
    });

    expect(result.score).toBe(0);
    expect(result.detail!.registered).toBe(true);
    expect(result.detail!.reason).toBeUndefined();
  });

  it("delisted charity (ABN match): registered=false, score=100, reason='acnc_delisted'", async () => {
    createServiceClientMock.mockReturnValue(
      makeAbnPathClient({
        data: {
          abn: "11005357522",
          charity_legal_name: "Former Charity Pty Ltd",
          charity_website: null,
          town_city: "Sydney",
          state: "NSW",
          postcode: "2000",
          charity_size: "Small",
          registration_date: "2018-06-01",
          is_pbi: false,
          is_hpc: false,
          operates_in_states: ["NSW"],
          is_delisted: true,
          delisted_at: "2026-04-15T10:30:00Z",
        },
        error: null,
      }),
    );

    const result = await runAcnc({
      abn: "11005357522",
      // no name
      // no website
    });

    expect(result.score).toBe(100);
    expect(result.detail!.registered).toBe(false);
    expect(result.detail!.reason).toBe("acnc_delisted");
    expect(result.detail!.delisted_at).toBe("2026-04-15T10:30:00Z");
    // Surface enough context to render a useful UI ("X was registered, now isn't")
    expect(result.detail!.charity_legal_name).toBe("Former Charity Pty Ltd");
  });

  it("ABN not found: registered=false, reason='abn_not_in_acnc_register' (NOT 'acnc_delisted')", async () => {
    createServiceClientMock.mockReturnValue(
      makeAbnPathClient({ data: null, error: null }),
    );

    const result = await runAcnc({
      abn: "99999999999",
      // no name
      // no website
    });

    expect(result.score).toBe(100);
    expect(result.detail!.reason).toBe("abn_not_in_acnc_register");
    // Discriminator: "delisted" means we have a row that says was-registered,
    // not-anymore. "not_in_register" means we never had a row. UIs should
    // render these differently.
    expect(result.detail!.reason).not.toBe("acnc_delisted");
  });
});

describe("acncProvider — name path delistment", () => {
  it("exact name match on a delisted charity: HIGH_RISK, reason='acnc_delisted'", async () => {
    createServiceClientMock.mockReturnValue(
      makeNamePathClient([
        {
          abn: "11005357522",
          charity_legal_name: "Suspicious Foundation",
          town_city: "Brisbane",
          state: "QLD",
          charity_website: null,
          is_delisted: true,
          similarity_score: 1.0,
        },
      ]),
    );

    const result = await runAcnc({
      // no abn
      name: "Suspicious Foundation",
      // no website
    });

    expect(result.score).toBe(100);
    expect(result.detail!.reason).toBe("acnc_delisted");
    expect(result.detail!.charity_legal_name).toBe("Suspicious Foundation");
  });

  it("exact name match on an active charity: registered=true, score=0", async () => {
    createServiceClientMock.mockReturnValue(
      makeNamePathClient([
        {
          abn: "11005357522",
          charity_legal_name: "Australian Red Cross Society",
          town_city: "Canberra",
          state: "ACT",
          charity_website: "https://redcross.org.au",
          is_delisted: false,
          similarity_score: 1.0,
        },
      ]),
    );

    const result = await runAcnc({
      // no abn
      name: "Australian Red Cross Society",
      // no website
    });

    expect(result.score).toBe(0);
    expect(result.detail!.registered).toBe(true);
    expect(result.detail!.reason).toBeUndefined();
  });

  it("non-exact name match: falls through to typosquat path (delistment is only checked on exact)", async () => {
    // Trigram top is delisted but the name doesn't match exactly →
    // typosquat path runs instead of delistment branch. Semantic call
    // is mocked to throw so we don't have to wire the full happy path.
    createServiceClientMock.mockReturnValue(
      makeNamePathClient([
        {
          abn: "11000000000",
          charity_legal_name: "Australian Red Cross Society",
          town_city: "Canberra",
          state: "ACT",
          charity_website: null,
          is_delisted: true, // <- delisted but name doesn't match
          similarity_score: 0.7,
        },
      ]),
    );
    embedQueryMock.mockRejectedValue(new Error("voyage offline (test)"));

    const result = await runAcnc({
      // no abn
      name: "Astralian Red Cross Society", // 1-edit typo
      // no website
    });

    // Falls through to typosquat handling → score=100, but reason is the
    // typosquat reason, not 'acnc_delisted'. This is intentional: the user
    // typed a typosquat of an ex-charity, the typosquat signal is the
    // higher-priority finding (impersonator behaviour).
    expect(result.score).toBe(100);
    expect(result.detail!.reason).not.toBe("acnc_delisted");
  });
});
