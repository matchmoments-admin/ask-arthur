import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";
import { createServiceClient } from "@askarthur/supabase/server";

function makeReq() {
  return new Request("https://example.com/api/cron/cost-daily-check", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function makeBelowCostSupabase(inboundEmailCount: number) {
  const todayCost = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { total_cost_usd: 0, event_count: 12 },
      error: null,
    }),
  };

  const inboundVolume = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockResolvedValue({ count: inboundEmailCount, error: null }),
  };

  const vonageUsage = {
    select: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [], error: null }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === "today_cost_total") return todayCost;
      if (table === "cost_telemetry") return inboundVolume;
      if (table === "telco_api_usage") return vonageUsage;
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.INBOUND_EMAIL_SPIKE_THRESHOLD_24H;
});

describe("cost-daily-check inbound-email volume alert", () => {
  it("pages on inbound-email volume spike even when daily spend is below threshold", async () => {
    process.env.INBOUND_EMAIL_SPIKE_THRESHOLD_24H = "500";
    vi.mocked(createServiceClient).mockReturnValue(
      makeBelowCostSupabase(501) as never,
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.belowThreshold).toBe(true);
    expect(body.inboundEmailVolumeSpike).toBe(true);
    expect(body.inboundEmailCount24h).toBe(501);
    expect(sendAdminTelegramMessage).toHaveBeenCalledTimes(1);
    const [message] = vi.mocked(sendAdminTelegramMessage).mock.calls[0];
    expect(message).toContain("inbound-email volume spike");
    expect(message).toContain("501");
  });

  it("does not page when inbound-email volume stays below threshold", async () => {
    process.env.INBOUND_EMAIL_SPIKE_THRESHOLD_24H = "500";
    vi.mocked(createServiceClient).mockReturnValue(
      makeBelowCostSupabase(499) as never,
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.belowThreshold).toBe(true);
    expect(body.inboundEmailVolumeSpike).toBe(false);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });
});
