// Coverage for getInitialFeed + getPinnedRegulatorAlerts extracted from
// the /scam-feed page.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

import { createServiceClient } from "@askarthur/supabase/server";
import { getInitialFeed, getPinnedRegulatorAlerts } from "../feed-loaders";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getInitialFeed — null-client fallback", () => {
  it("returns empty items/total when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getInitialFeed()).toEqual({ items: [], total: 0 });
  });
});

describe("getInitialFeed — happy path", () => {
  it("returns items + total from the published-feed query", async () => {
    const items = [
      { id: 1, source: "reddit", title: "Test", published: true },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: items, count: 1, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getInitialFeed();
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it("returns empty when query errors", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({
        data: null,
        count: null,
        error: { message: "DB down" },
      }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    expect(await getInitialFeed()).toEqual({ items: [], total: 0 });
  });
});

describe("getPinnedRegulatorAlerts — null-client fallback", () => {
  it("returns [] when createServiceClient returns null", async () => {
    vi.mocked(createServiceClient).mockReturnValue(null);
    expect(await getPinnedRegulatorAlerts()).toEqual([]);
  });
});

describe("getPinnedRegulatorAlerts — happy path", () => {
  it("returns regulator alerts from the query", async () => {
    const alerts = [
      {
        id: 1,
        source: "scamwatch_alert",
        title: "Alert",
        url: "https://example.test",
        published_at: "2026-05-18T00:00:00Z",
        created_at: "2026-05-18T00:00:00Z",
      },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: alerts, error: null }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };
    vi.mocked(createServiceClient).mockReturnValue(
      supabase as unknown as ReturnType<typeof createServiceClient>,
    );

    const result = await getPinnedRegulatorAlerts();
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("scamwatch_alert");
  });
});
