import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  count: 0 as number | null,
  error: null as { message: string } | null,
  queries: 0,
}));
vi.mock("../cost-log", () => ({ logCost: vi.fn(async () => undefined) }));
vi.mock("@askarthur/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.gte = async () => {
        m.queries += 1;
        return { count: m.count, error: m.error };
      };
      return chain;
    },
  }),
}));

import { logCost } from "../cost-log";
import { lookupDomainRegistration } from "../domain-registration";
import {
  WHOISJSON_MONTHLY_GUARD,
  WHOIS_HTTP_RETRY_MS,
  __resetWhoisQuotaCacheForTests,
  lookupWhois,
  startOfNextMonthUtc,
  whoisScamUrlColumns,
} from "../whois";

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({ registrar: { name: "NameCheap, Inc." }, created: "2026-06-02" }),
}));

beforeEach(() => {
  process.env.WHOIS_API_KEY = "test-key";
  __resetWhoisQuotaCacheForTests();
  m.count = 0;
  m.error = null;
  m.queries = 0;
  vi.mocked(logCost).mockReset();
  vi.mocked(logCost).mockImplementation(async () => undefined);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WHOIS_API_KEY;
});

// whoisjson's free tier is 1,000/month; the fleet ran ~1,200–1,300 (2026-09).
describe("whoisjson monthly quota guard", () => {
  it("interactive looks up below its 950 guard", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.interactive - 1;
    const r = await lookupWhois("x.shop", { priority: "interactive" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(r.registrar).toBe("NameCheap, Inc.");
  });

  it("interactive skips at 950", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.interactive;
    const r = await lookupWhois("x.shop", { priority: "interactive" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.registrar).toBeNull();
  });

  it("batch stops at 700 while interactive still has headroom", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.batch;
    await lookupWhois("a.shop", { priority: "batch" });
    expect(fetchMock).not.toHaveBeenCalled();
    await lookupWhois("b.shop", { priority: "interactive" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("interactive fails OPEN when the count can't be read (null count, no error)", async () => {
    m.count = null;
    const r = await lookupWhois("x.shop", { priority: "interactive" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(r.deferral).toBeUndefined();
  });

  it("interactive fails OPEN on a count read error too", async () => {
    m.count = null;
    m.error = { message: "timeout" };
    await lookupWhois("x.shop", { priority: "interactive" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caches the count and advances it locally, so the guard trips without re-querying", async () => {
    m.count = WHOISJSON_MONTHLY_GUARD.interactive - 1;
    await lookupWhois("a.shop", { priority: "interactive" }); // 949 read, +1 locally → 950
    await lookupWhois("b.shop", { priority: "interactive" }); // cached 950 → skipped
    expect(m.queries).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

/**
 * #1253 — an unanswered lookup is distinguishable from a served-but-empty one.
 * Before, every path below returned the same all-null object as a 200 with no
 * registrar, and the clone-watch enricher saved it as final.
 *
 * Go-red (2026-09-27, each reverted → failed → restored): make the guard
 * branch `return EMPTY_RESULT` again → "quota guard → quota_deferred" fails
 * on `deferral` undefined; make the non-200 branch do the same → "non-200 →
 * http_error" fails.
 */
describe("lookupWhois deferral (#1253)", () => {
  it("quota guard → quota_deferred, retry at the 1st of next month UTC, no request", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-20T13:30:00Z"), toFake: ["Date"] });
    try {
      m.count = WHOISJSON_MONTHLY_GUARD.batch;
      const r = await lookupWhois("x.shop", { priority: "batch" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r.registrar).toBeNull();
      expect(r.deferral).toEqual({
        reason: "quota_deferred",
        retryAfter: "2026-10-01T00:00:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-200 (not 429) → http_error with status, retry in 24h", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as never);
    const before = Date.now();
    const r = await lookupWhois("x.shop", { priority: "batch" });
    expect(r.deferral?.reason).toBe("http_error");
    expect(r.deferral?.status).toBe(503);
    const at = new Date(r.deferral!.retryAfter).getTime();
    expect(at - before).toBeGreaterThanOrEqual(WHOIS_HTTP_RETRY_MS - 1000);
    expect(at - before).toBeLessThanOrEqual(WHOIS_HTTP_RETRY_MS + 5000);
  });

  it("a thrown request (timeout / network) → http_error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("aborted") as never);
    const r = await lookupWhois("x.shop", { priority: "batch" });
    expect(r.deferral?.reason).toBe("http_error");
    expect(r.deferral?.status).toBeUndefined();
  });

  // #1259 review. Go-red (2026-09-27): map every non-200 to http_error
  // again → this fails (reason http_error, retry +24h).
  it("a whoisjson 429 is quota, not a failure → quota_deferred to the 1st, status kept", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T13:30:00Z"), toFake: ["Date"] });
    try {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as never);
      const r = await lookupWhois("x.shop", { priority: "batch" });
      expect(r.deferral).toEqual({
        reason: "quota_deferred",
        retryAfter: "2026-10-01T00:00:00.000Z",
        status: 429,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // #1259 review. Go-red (2026-09-27): give not_configured the +24h retry
  // again → this fails (daily churn on a missing key).
  it("no key → not_configured, no request, retry on the 1st (not daily)", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-24T13:30:00Z"), toFake: ["Date"] });
    try {
      delete process.env.WHOIS_API_KEY;
      const r = await lookupWhois("x.shop", { priority: "batch" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(r.deferral).toEqual({
        reason: "not_configured",
        retryAfter: "2026-10-01T00:00:00.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a served 200 carries NO deferral, even with no registrar — that answer is final", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) } as never);
    const r = await lookupWhois("x.shop", { priority: "batch" });
    expect(r.registrar).toBeNull();
    expect(r.deferral).toBeUndefined();
  });

  it("startOfNextMonthUtc rolls December into January", () => {
    expect(startOfNextMonthUtc(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

// #1259 review — the ONE scam_urls whois_* mapping. Go-red (2026-09-27):
// drop the `if (w.deferral) return {}` → "a deferred lookup maps to no
// columns" fails.
describe("whoisScamUrlColumns", () => {
  const served = {
    registrar: "R",
    registrarAbuseEmail: null,
    registrantCountry: "AU",
    createdDate: "2026-01-01",
    expiresDate: null,
    nameServers: ["ns1"],
    isPrivate: false,
    raw: null,
  };
  it("a served lookup maps every whois_* column and stamps whois_lookup_at", () => {
    expect(whoisScamUrlColumns(served, "T")).toMatchObject({
      whois_registrar: "R",
      whois_created_date: "2026-01-01",
      whois_lookup_at: "T",
    });
  });
  it("a deferred lookup maps to no columns (no nulls, no whois_lookup_at)", () => {
    expect(
      whoisScamUrlColumns(
        {
          ...served,
          registrar: null,
          deferral: { reason: "quota_deferred", retryAfter: "2026-10-01T00:00:00.000Z" },
        },
        "T",
      ),
    ).toEqual({});
  });
});

/**
 * PR-F — the guard's count is durable, batch fails closed on an unreadable
 * count, and priority cannot be forgotten.
 *
 * Go-red (2026-09-28, each reverted → failed → restored):
 *   - "the counted row is written before the lookup returns": `void` instead
 *     of `await` on the insert (first the direct call, then — after the
 *     review's concurrency nit — the `finally { await logged }`) → the lookup
 *     settles while the insert is still pending, and `settled` reads true.
 *   - "batch fails CLOSED on an unreadable count": delete the
 *     `used === null && priority === "batch"` branch → fetch is called and
 *     `deferral` is undefined.
 *   - "priority is required" (a TYPE guard — `pnpm --filter
 *     @askarthur/scam-engine typecheck` is the runner): make `priority`
 *     optional again on either function → the `@ts-expect-error` lines below
 *     become unused and tsc fails with TS2578.
 */
describe("whoisjson quota count — PR-F", () => {
  it("the counted row is written before the lookup returns (awaited, not fire-and-forget)", async () => {
    let release!: () => void;
    vi.mocked(logCost).mockImplementation(
      () => new Promise<void>((r) => (release = r)),
    );
    let settled = false;
    const p = lookupWhois("x.shop", { priority: "batch" }).then((r) => {
      settled = true;
      return r;
    });
    // Let every microtask/macrotask ahead of the insert run.
    await new Promise((r) => setTimeout(r, 20));
    expect(logCost).toHaveBeenCalledWith(
      expect.objectContaining({ feature: "whois", provider: "whoisjson" }),
    );
    expect(settled).toBe(false);
    release();
    const r = await p;
    expect(settled).toBe(true);
    expect(r.registrar).toBe("NameCheap, Inc.");
  });

  it("batch fails CLOSED on an unreadable count: quota_unknown, no request, retry in 24h", async () => {
    m.count = null;
    const before = Date.now();
    const r = await lookupWhois("x.shop", { priority: "batch" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.registrar).toBeNull();
    expect(r.deferral?.reason).toBe("quota_unknown");
    expect(r.deferral?.status).toBeUndefined();
    const at = new Date(r.deferral!.retryAfter).getTime();
    expect(at - before).toBeGreaterThanOrEqual(WHOIS_HTTP_RETRY_MS - 1000);
    expect(at - before).toBeLessThanOrEqual(WHOIS_HTTP_RETRY_MS + 5000);
  });

  it("batch fails CLOSED on a count read error as well", async () => {
    m.count = null;
    m.error = { message: "timeout" };
    const r = await lookupWhois("x.shop", { priority: "batch" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.deferral?.reason).toBe("quota_unknown");
  });

  it("priority is required on lookupWhois and lookupDomainRegistration (type guard)", () => {
    // Never invoked — the assertion is the compile. tsc fails (TS2578) if
    // either `@ts-expect-error` stops being needed.
    const typeOnly = () => {
      // @ts-expect-error — priority is required: no default share for a caller that forgot it
      void lookupWhois("x.shop");
      // @ts-expect-error — the opts object itself is required too
      void lookupWhois("x.shop", {});
      // @ts-expect-error — lookupDomainRegistration used to pass `undefined` through
      void lookupDomainRegistration("x.shop");
      // @ts-expect-error — the opts object itself is required too
      void lookupDomainRegistration("x.shop", {});
    };
    expect(typeof typeOnly).toBe("function");
  });
});
