// Coverage for the public-stats loaders extracted from /about and
// /scam-map. Both pages previously had inline null-client fallbacks
// with no test coverage.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/chart-tokens", () => ({
  parseStateFromRegion: (region: string) => {
    if (region.toLowerCase().includes("new south wales")) return "NSW";
    if (region.toLowerCase().includes("victoria")) return "VIC";
    return null;
  },
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getChartData, getWorldStats } from "../public-stats";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getChartData — null-client fallback", () => {
  it("returns zeros when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getChartData()).toEqual({
      safeCount: 0,
      suspiciousCount: 0,
      highRiskCount: 0,
      stateData: {},
    });
  });
});

describe("getChartData — happy path", () => {
  it("aggregates per-row counts and per-state totals", async () => {
    const chain = {
      select: vi.fn().mockResolvedValue({
        data: [
          {
            safe_count: 10,
            suspicious_count: 3,
            high_risk_count: 1,
            region: "Sydney, New South Wales",
          },
          {
            safe_count: 5,
            suspicious_count: 2,
            high_risk_count: 0,
            region: "Melbourne, Victoria",
          },
          {
            safe_count: 7,
            suspicious_count: 0,
            high_risk_count: 0,
            region: null,
          },
        ],
        error: null,
      }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getChartData();
    expect(result.safeCount).toBe(22);
    expect(result.suspiciousCount).toBe(5);
    expect(result.highRiskCount).toBe(1);
    expect(result.stateData).toEqual({ NSW: 14, VIC: 7 });
  });
});

describe("getWorldStats — null-client fallback", () => {
  it("returns {} when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getWorldStats()).toEqual({});
  });
});

describe("getWorldStats — happy path", () => {
  it("returns a country_code → scam_count map from rpc result", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          { country_code: "AU", scam_count: 42 },
          { country_code: "US", scam_count: 17 },
        ],
        error: null,
      }),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    expect(await getWorldStats()).toEqual({ AU: 42, US: 17 });
  });
});
