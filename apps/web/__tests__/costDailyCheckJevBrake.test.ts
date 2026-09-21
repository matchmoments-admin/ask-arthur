import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Jev shadow lane (v311) has no brake key of its own: its spend rolls
// into `shopfront_clone_outreach` via the cost-daily-check aggregator, the
// same cap that already covers the Haiku pre-classifier it runs beside.
// This pins that wiring — a feature tag missing from the filter is spend
// with no brake, which is exactly the "documented but inert control" class.
// Mock shape mirrors costDailyCheckHiveBrake.test.ts.
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from "@/app/api/cron/cost-daily-check/route";
import { createServiceClient } from "@askarthur/supabase/server";

function makeReq() {
  return new Request("https://example.com/api/cron/cost-daily-check", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function makeSupabaseMock(
  summaryRows: Array<{
    feature: string;
    provider: string;
    event_count: number;
    total_cost_usd: number;
  }>,
) {
  const brakeUpserts: Array<Record<string, unknown>> = [];
  const totalCostUsd = summaryRows.reduce((s, r) => s + r.total_cost_usd, 0);
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "today_cost_total") {
        return {
          select: vi.fn().mockReturnThis(),
          single: vi
            .fn()
            .mockResolvedValue({
              data: { total_cost_usd: totalCostUsd, event_count: 10 },
              error: null,
            }),
        };
      }
      if (table === "telco_api_usage") {
        return {
          select: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      if (table === "daily_cost_summary") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: summaryRows, error: null }),
        };
      }
      if (table === "feature_brakes") {
        return {
          upsert: vi.fn((row: Record<string, unknown>) => {
            brakeUpserts.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      if (table === "cost_telemetry") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { supabase, brakeUpserts };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  delete process.env.SHOPFRONT_CLONE_OUTREACH_CAP_USD;
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.SHOPFRONT_CLONE_OUTREACH_CAP_USD;
});

describe("cost-daily-check — Jev shadow lane rolls into shopfront_clone_outreach", () => {
  it("counts shopfront_clone_preclassify_jev (+ _error) toward the outreach cap", async () => {
    // Haiku alone sits under the $5 default; the Jev tags must be what tips it.
    const { supabase, brakeUpserts } = makeSupabaseMock([
      {
        feature: "shopfront_clone_preclassify",
        provider: "anthropic",
        event_count: 50,
        total_cost_usd: 3.0,
      },
      {
        feature: "shopfront_clone_preclassify_jev",
        provider: "typesafe",
        event_count: 50,
        total_cost_usd: 1.5,
      },
      {
        feature: "shopfront_clone_preclassify_jev_error",
        provider: "typesafe",
        event_count: 3,
        total_cost_usd: 0.6,
      },
    ]);
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    const brake = brakeUpserts.find(
      (b) => b.feature === "shopfront_clone_outreach",
    );
    expect(brake).toBeDefined();
    expect(brake!.set_cost_usd).toBeCloseTo(5.1);
    expect(brake!.set_threshold_usd).toBe(5);
    expect(
      body.brakesSet?.shopfront_clone_outreach ??
        body.shopfrontCloneOutreachBrakeSet,
    ).toBe(true);
  });
});
