import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Below-threshold silent brake engage: EVERY brake must set condition_met.
// Mirrors the mock shape of scraperBrakeAlert.test.ts: supabase + telegram
// mocked before the route import, per-test data via makeSupabaseMock.
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/bots/telegram/sendAdminMessage", () => ({
  // Must resolve to an AdminMessageResult, not undefined: alertAndRecord()
  // inspects .ok to decide the outcome it records.
  sendAdminTelegramMessage: vi.fn(async () => ({ ok: true, latencyMs: 1 })),
}));
const recordAlertDelivery = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/alerting/deliveryLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/alerting/deliveryLog")>()),
  recordAlertDelivery,
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
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

// review 2026-09-24: `anyBrakeSet` OR'd four of thirteen brakes by hand, so
// shopfront_clone_watch — whose $1 default cap sits structurally below the $2
// global Telegram gate, so it can ONLY engage silently — never set
// condition_met. It is now derived from the reported brakesSet map.
describe("cost-daily-check silent brake engage", () => {
  it("records condition_met when shopfront_clone_watch engages below the global threshold", async () => {
    const { supabase, brakeUpserts } = makeSupabaseMock({
      totalCostUsd: 1.5,
      summaryRows: [
        { feature: "shopfront_clone_watch", provider: "urlscan", event_count: 50, total_cost_usd: 1.5 },
      ],
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    const body = await res.json();

    expect(body.belowThreshold).toBe(true);
    expect(brakeUpserts.some((b) => b.feature === "shopfront_clone_watch")).toBe(true);
    expect(body.brakesSet.shopfront_clone_watch).toBe(true);
    expect(recordAlertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        conditionMet: true,
        metadata: expect.objectContaining({ silentBrakeEngage: true }),
      }),
    );
  });

  it("no brake → no_alert_needed", async () => {
    const { supabase } = makeSupabaseMock({ totalCostUsd: 0.1, summaryRows: [] });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);
    await GET(makeReq());
    expect(recordAlertDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ conditionMet: false, outcome: "no_alert_needed" }),
    );
  });
});
