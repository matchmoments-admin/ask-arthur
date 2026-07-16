import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { searchURLScan } from "../urlscan-search";

const origFetch = globalThis.fetch;
const origKey = process.env.URLSCAN_API_KEY;

describe("searchURLScan", () => {
  beforeEach(() => {
    process.env.URLSCAN_API_KEY = "test-key";
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origKey === undefined) delete process.env.URLSCAN_API_KEY;
    else process.env.URLSCAN_API_KEY = origKey;
  });

  it("no key → { ok:false, error:'no_key' } and no fetch", async () => {
    delete process.env.URLSCAN_API_KEY;
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const r = await searchURLScan('page.ip:"1.2.3.4"');
    expect(r).toEqual({ ok: false, error: "no_key" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("429 → { ok:false, error:'rate_limited' } (quota, not failure)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ status: 429, ok: false }) as unknown as typeof fetch;
    const r = await searchURLScan('page.ip:"1.2.3.4"');
    expect(r).toEqual({ ok: false, error: "rate_limited" });
  });

  it("200 → parsed, deduped hits with domain/url/lastSeen", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        total: 2,
        results: [
          { page: { domain: "a.shop", url: "https://a.shop/" }, task: { time: "2026-07-16T00:00:00Z" } },
          { task: { domain: "b.shop", url: "https://b.shop/", time: "2026-07-15T00:00:00Z" } },
        ],
      }),
    }) as unknown as typeof fetch;
    const r = await searchURLScan('page.ip:"1.2.3.4"');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.total).toBe(2);
      expect(r.results).toEqual([
        { domain: "a.shop", url: "https://a.shop/", lastSeen: "2026-07-16T00:00:00Z" },
        { domain: "b.shop", url: "https://b.shop/", lastSeen: "2026-07-15T00:00:00Z" },
      ]);
    }
  });

  it("non-200/429 → { ok:false, error:'http_error' }", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ status: 500, ok: false }) as unknown as typeof fetch;
    const r = await searchURLScan('page.ip:"1.2.3.4"');
    expect(r).toEqual({ ok: false, error: "http_error" });
  });
});
