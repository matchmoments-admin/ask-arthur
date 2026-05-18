// Coverage for getCheckTimeSeries appended to apps/web/lib/dashboard.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getCheckTimeSeries } from "../dashboard";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCheckTimeSeries — null-client fallback", () => {
  it("returns [] when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getCheckTimeSeries(30)).toEqual([]);
  });
});

describe("getCheckTimeSeries — happy path", () => {
  it("groups rows by date and sums total/high_risk", async () => {
    const rows = [
      { date: "2026-05-17", total_checks: 10, high_risk_count: 2 },
      { date: "2026-05-17", total_checks: 5, high_risk_count: 1 },
      { date: "2026-05-18", total_checks: 8, high_risk_count: 0 },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getCheckTimeSeries(7);
    expect(result).toHaveLength(2);
    const may17 = result.find((r) => r.date === "2026-05-17");
    expect(may17).toEqual({ date: "2026-05-17", total: 15, high_risk: 3 });
    const may18 = result.find((r) => r.date === "2026-05-18");
    expect(may18).toEqual({ date: "2026-05-18", total: 8, high_risk: 0 });
  });

  it("returns [] when data is null", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    expect(await getCheckTimeSeries(30)).toEqual([]);
  });
});
