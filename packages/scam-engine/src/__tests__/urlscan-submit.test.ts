import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitURLScanWithDetails } from "../urlscan";

// Surgical coverage for the discriminated-result submitter that backs the
// clone-watch persist-on-failure flow (issue #441 + alert 468 rejection).
// We test each failure branch hits the right `error` tag so the row's
// urlscan_evidence telemetry is dashboard-groupable.

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.URLSCAN_API_KEY;

describe("submitURLScanWithDetails", () => {
  beforeEach(() => {
    process.env.URLSCAN_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.URLSCAN_API_KEY = ORIGINAL_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns { ok: false, error: 'no_api_key' } when env missing", async () => {
    delete process.env.URLSCAN_API_KEY;
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("no_api_key");
  });

  it("returns { ok: true, uuid } on 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ uuid: "u-1", api: "https://api/u-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.uuid).toBe("u-1");
      expect(result.apiUrl).toBe("https://api/u-1");
    }
  });

  it("returns { ok: false, error: 'rate_limited', status: 429 } on 429", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Too Many Requests", { status: 429 }),
    );
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("rate_limited");
      expect(result.status).toBe(429);
    }
  });

  it("returns { ok: false, error: 'rejected', status: 400 } on 400 (alert 468 shape)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Submission failed: scanning this URL is not allowed", {
        status: 400,
      }),
    );
    const result = await submitURLScanWithDetails("https://westpachomesb.info/");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("rejected");
      expect(result.status).toBe(400);
      expect(result.message).toContain("not allowed");
    }
  });

  it("returns { ok: false, error: 'http_error', status } on other 5xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Internal Server Error", { status: 503 }),
    );
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("http_error");
      expect(result.status).toBe(503);
    }
  });

  it("returns { ok: false, error: 'network_error' } on fetch throw", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new TypeError("getaddrinfo ENOTFOUND"),
    );
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("network_error");
  });

  it("returns { ok: false, error: 'timeout' } on AbortError", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    );
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("timeout");
  });

  it("truncates oversized error bodies to 500 chars", async () => {
    const longBody = "x".repeat(2000);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(longBody, { status: 400 }),
    );
    const result = await submitURLScanWithDetails("https://example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message?.length).toBeLessThanOrEqual(500);
    }
  });
});
