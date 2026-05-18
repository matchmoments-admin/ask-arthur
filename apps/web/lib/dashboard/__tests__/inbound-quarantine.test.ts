// Coverage for getQuarantineRows + the subscription-admin heuristic.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getQuarantineRows } from "../inbound-quarantine";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getQuarantineRows — null-client fallback", () => {
  it("returns [] when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getQuarantineRows()).toEqual([]);
  });
});

describe("getQuarantineRows — happy path", () => {
  it("flags subscription-admin titles + truncates body preview to 600 chars", async () => {
    const longBody = "a".repeat(900);
    const rows = [
      {
        id: 1,
        source: "inbound_scamwatch",
        title: "Real scam alert",
        body_md: "short body",
        url: "https://example.test",
        country_code: "AU",
        source_created_at: "2026-05-18T00:00:00Z",
        created_at: "2026-05-18T00:00:00Z",
      },
      {
        id: 2,
        source: "inbound_generic",
        title: "Confirm your subscription",
        body_md: longBody,
        url: null,
        country_code: null,
        source_created_at: null,
        created_at: "2026-05-18T00:00:00Z",
      },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getQuarantineRows();
    expect(result).toHaveLength(2);

    const real = result.find((r) => r.id === 1);
    expect(real?.is_subscription_admin).toBe(false);
    expect(real?.is_regulator).toBe(true); // inbound_scamwatch is regulator

    const admin = result.find((r) => r.id === 2);
    expect(admin?.is_subscription_admin).toBe(true);
    expect(admin?.body_chars).toBe(900);
    expect(admin?.body_preview.length).toBe(600);
  });

  it("falls back to created_at when source_created_at is null", async () => {
    const rows = [
      {
        id: 3,
        source: "inbound_idcare",
        title: "Test",
        body_md: "body",
        url: null,
        country_code: null,
        source_created_at: null,
        created_at: "2026-05-18T00:00:00Z",
      },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getQuarantineRows();
    expect(result[0].received_at).toBe("2026-05-18T00:00:00Z");
  });
});
