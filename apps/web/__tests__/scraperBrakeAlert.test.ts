import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the supabase client + telegram sender BEFORE importing the route.
// The mocks are configured per-test via the mockReturnValueOnce/mockResolvedValueOnce
// surfaces below.
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

import { GET } from "@/app/api/cron/scraper-brake-alert/route";
import { createServiceClient } from "@askarthur/supabase/server";
import { sendAdminTelegramMessage } from "@/lib/bots/telegram/sendAdminMessage";

const PREFIX = "backoff_active:";

function makeReq() {
  return new Request("https://example.com/api/cron/scraper-brake-alert", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function makeSupabaseMock(opts: {
  recentRows: Array<{
    feed_name: string;
    status: string;
    error_message: string | null;
    created_at: string;
  }>;
  // Map of feed_name → "the row immediately preceding the most recent
  // backoff partial" (or null if no prior row exists).
  priorRows: Record<
    string,
    { status: string; error_message: string | null; created_at: string } | null
  >;
}) {
  // Top-level recent-rows query.
  const recentChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: opts.recentRows, error: null }),
  };

  // Per-feed prior-row probe inside the loop. Each call to `from(...)`
  // for the same table returns a fresh chain; we use the second-most-recent
  // returned by `eq("feed_name", X).lt(...).order(...).limit(1).maybeSingle()`.
  const priorChainFactory = (feedName: string) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.priorRows[feedName] ?? null,
      error: null,
    }),
  });

  const fromCalls: Array<{ table: string }> = [];
  let recentReturned = false;

  const supabase = {
    from: vi.fn((table: string) => {
      fromCalls.push({ table });
      if (!recentReturned) {
        recentReturned = true;
        return recentChain;
      }
      // Subsequent .from() calls are the per-feed prior probes. We need
      // to know which feed_name eq() will be called with — capture it.
      let capturedFeed: string | null = null;
      const chain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn(function (this: unknown, _col: string, val: string) {
          capturedFeed = val;
          return chain;
        }),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: capturedFeed ? opts.priorRows[capturedFeed] ?? null : null,
            error: null,
          }),
        ),
      };
      return chain;
    }),
  };

  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("scraper-brake-alert cron", () => {
  it("rejects unauthenticated requests", async () => {
    const req = new Request("https://example.com/api/cron/scraper-brake-alert");
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });

  it("returns ok with alerted=0 when no recent backoff partials", async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      makeSupabaseMock({ recentRows: [], priorRows: {} }) as never,
    );

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerted).toBe(0);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });

  it("pages once on a fresh activation (prior row was an error)", async () => {
    const supabase = makeSupabaseMock({
      recentRows: [
        {
          feed_name: "acsc",
          status: "partial",
          error_message: `${PREFIX} 3 consecutive failures (threshold=3)`,
          created_at: "2026-05-10T12:00:00Z",
        },
      ],
      priorRows: {
        acsc: {
          status: "error",
          error_message: "HTTPSConnectionPool timeout",
          created_at: "2026-05-10T11:30:00Z",
        },
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerted).toBe(1);
    expect(body.feeds).toEqual(["acsc"]);
    expect(sendAdminTelegramMessage).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(sendAdminTelegramMessage).mock.calls[0];
    expect(msg).toContain("Scraper circuit breaker tripped");
    expect(msg).toContain("acsc");
  });

  it("does NOT page when prior row was already a backoff partial (cooldown skip)", async () => {
    const supabase = makeSupabaseMock({
      recentRows: [
        {
          feed_name: "acsc",
          status: "partial",
          error_message: `${PREFIX} 3 consecutive failures`,
          created_at: "2026-05-10T12:00:00Z",
        },
      ],
      priorRows: {
        acsc: {
          status: "partial",
          error_message: `${PREFIX} 3 consecutive failures`,
          created_at: "2026-05-10T11:45:00Z",
        },
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.alerted).toBe(0);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });

  it("dedupes multiple recent backoff rows for the same feed", async () => {
    // Two backoff partials within the lookback window for the same feed —
    // we should still only consider the most recent one and only page if
    // its prior row isn't a backoff partial.
    const supabase = makeSupabaseMock({
      recentRows: [
        {
          feed_name: "acsc",
          status: "partial",
          error_message: `${PREFIX} 3`,
          created_at: "2026-05-10T12:15:00Z",
        },
        {
          feed_name: "acsc",
          status: "partial",
          error_message: `${PREFIX} 3`,
          created_at: "2026-05-10T12:00:00Z",
        },
      ],
      priorRows: {
        acsc: {
          status: "partial", // prior is also backoff → suppress
          error_message: `${PREFIX} 3`,
          created_at: "2026-05-10T11:45:00Z",
        },
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.alerted).toBe(0);
    expect(sendAdminTelegramMessage).not.toHaveBeenCalled();
  });

  it("pages on multiple distinct feeds in one sweep", async () => {
    const supabase = makeSupabaseMock({
      recentRows: [
        {
          feed_name: "acsc",
          status: "partial",
          error_message: `${PREFIX} 3 consecutive failures`,
          created_at: "2026-05-10T12:00:00Z",
        },
        {
          feed_name: "phishtank",
          status: "partial",
          error_message: `${PREFIX} 5 consecutive failures`,
          created_at: "2026-05-10T12:01:00Z",
        },
      ],
      priorRows: {
        acsc: { status: "error", error_message: "HTTP 403", created_at: "2026-05-10T11:30:00Z" },
        phishtank: {
          status: "error",
          error_message: "HTTP 503",
          created_at: "2026-05-10T11:55:00Z",
        },
      },
    });
    vi.mocked(createServiceClient).mockReturnValue(supabase as never);

    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.alerted).toBe(2);
    expect(body.feeds.sort()).toEqual(["acsc", "phishtank"]);
    expect(sendAdminTelegramMessage).toHaveBeenCalledTimes(1);
    const [msg] = vi.mocked(sendAdminTelegramMessage).mock.calls[0];
    expect(msg).toContain("acsc");
    expect(msg).toContain("phishtank");
  });
});
