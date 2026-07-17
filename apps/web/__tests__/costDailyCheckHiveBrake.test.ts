import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hive AI brake wiring in the cost-daily-check cron (extension image scans).
// Mirrors the mock shape of scraperBrakeAlert.test.ts: supabase + telegram
// mocked before the route import, per-test data via makeSupabaseMock.
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  sendAdminTelegramMessage: vi.fn(),
}));
vi.mock("@askarthur/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

import { GET } from "@/app/api/cron/cost-daily-check/route";
import { createServiceClient } from "@askarthur/supabase/server";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

function makeReq() {
  return new Request("https://example.com/api/cron/cost-daily-check", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function makeSupabaseMock(opts: {
  totalCostUsd: number;
  eventCount?: number;
  summaryRows: Array<{
    feature: string;
    provider: string;
    event_count: number;
    total_cost_usd: number;
  }>;
}) {
  const brakeUpserts: Array<Record<string, unknown>> = [];

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "today_cost_total") {
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              total_cost_usd: opts.totalCostUsd,
              event_count: opts.eventCount ?? 10,
            },
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
          limit: vi.fn().mockResolvedValue({ data: opts.summaryRows, error: null }),
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
  delete process.env.HIVE_AI_CAP_USD;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.HIVE_AI_CAP_USD;
});

describe("cost-daily-check hive_ai brake", () => {
  it("engages the hive_ai brake when spend exceeds the $5 default cap", async () => {
    const { supabase, brakeUpserts } = makeSupabaseMock({
      totalCostUsd: 6.2,
      summaryRows: [
        { feature: "hive_ai", provider: "hive", event_count: 2100, total_cost_usd: 6.2 },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();

    const hiveBrake = brakeUpserts.find((b) => b.feature === "hive_ai");
    expect(hiveBrake).toBeDefined();
    expect(hiveBrake!.set_cost_usd).toBeCloseTo(6.2);
    expect(hiveBrake!.set_threshold_usd).toBe(5);
    expect(body.hiveAiBrakeSet).toBe(true);
    expect(body.hiveAiCost).toBeCloseTo(6.2);

    // Total > $2 global threshold → Telegram digest includes the brake line.
    expect(sendAdminTelegramMessage).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(sendAdminTelegramMessage).mock.calls[0];
    expect(msg).toContain("hive_ai brake engaged");
  });

  it("does not engage the brake below the cap, and reports it in brakesSet", async () => {
    const { supabase, brakeUpserts } = makeSupabaseMock({
      totalCostUsd: 0.9,
      summaryRows: [
        { feature: "hive_ai", provider: "hive", event_count: 300, total_cost_usd: 0.9 },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(brakeUpserts.find((b) => b.feature === "hive_ai")).toBeUndefined();
    // Below the $2 global threshold → belowThreshold branch, no Telegram.
    expect(body.belowThreshold).toBe(true);
    expect(body.brakesSet.hive_ai).toBe(false);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });

  it("respects a HIVE_AI_CAP_USD env override", async () => {
    process.env.HIVE_AI_CAP_USD = "10";
    const { supabase, brakeUpserts } = makeSupabaseMock({
      totalCostUsd: 6.2,
      summaryRows: [
        { feature: "hive_ai", provider: "hive", event_count: 2100, total_cost_usd: 6.2 },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    const body = await res.json();

    // $6.20 spend under the raised $10 cap → no brake.
    expect(brakeUpserts.find((b) => b.feature === "hive_ai")).toBeUndefined();
    expect(body.hiveAiBrakeSet).toBe(false);
  });
});
