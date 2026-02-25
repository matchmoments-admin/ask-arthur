import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isKnownShortener,
  detectOpenRedirect,
  resolveRedirectChain,
  resolveRedirects,
  extractFinalUrls,
} from "@askarthur/scam-engine/redirect-resolver";

// ── isKnownShortener ──

describe("isKnownShortener", () => {
  it("returns true for bit.ly", () => {
    expect(isKnownShortener("https://bit.ly/abc123")).toBe(true);
  });

  it("returns true for t.co", () => {
    expect(isKnownShortener("https://t.co/xyz")).toBe(true);
  });

  it("returns true for tinyurl.com", () => {
    expect(isKnownShortener("https://tinyurl.com/y1234")).toBe(true);
  });

  it("returns false for google.com", () => {
    expect(isKnownShortener("https://google.com")).toBe(false);
  });

  it("returns false for example.com", () => {
    expect(isKnownShortener("https://example.com/short")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(isKnownShortener("not-a-url")).toBe(false);
  });
});

// ── detectOpenRedirect ──

describe("detectOpenRedirect", () => {
  it("detects google.com/url?q= redirect", () => {
    expect(
      detectOpenRedirect("https://www.google.com/url?q=https://evil.com")
    ).toBe(true);
  });

  it("detects facebook l.php redirect", () => {
    expect(
      detectOpenRedirect("https://l.facebook.com/l.php?u=https://evil.com")
    ).toBe(true);
  });

  it("detects youtube redirect", () => {
    expect(
      detectOpenRedirect(
        "https://www.youtube.com/redirect?q=https://evil.com"
      )
    ).toBe(true);
  });

  it("detects generic redirect param with URL value", () => {
    expect(
      detectOpenRedirect(
        "https://example.com/login?redirect=https://evil.com"
      )
    ).toBe(true);
  });

  it("returns false for normal google.com URL", () => {
    expect(detectOpenRedirect("https://www.google.com/search?q=hello")).toBe(
      false
    );
  });

  it("returns false for normal URL without redirect params", () => {
    expect(detectOpenRedirect("https://example.com/page?id=123")).toBe(false);
  });

  it("returns false for invalid URL", () => {
    expect(detectOpenRedirect("not-a-url")).toBe(false);
  });
});

// ── resolveRedirectChain ──

describe("resolveRedirectChain", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("handles direct 200 response (no redirect)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const chain = await resolveRedirectChain("https://example.com");
    expect(chain.originalUrl).toBe("https://example.com");
    expect(chain.finalUrl).toBe("https://example.com");
    expect(chain.hopCount).toBe(1);
    expect(chain.hops[0].statusCode).toBe(200);
    expect(chain.isShortened).toBe(false);
    expect(chain.truncated).toBe(false);
  });

  it("follows a single 301 redirect", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 301,
            headers: { Location: "https://destination.com/page" },
          })
        );
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const chain = await resolveRedirectChain("https://bit.ly/abc");
    expect(chain.originalUrl).toBe("https://bit.ly/abc");
    expect(chain.finalUrl).toBe("https://destination.com/page");
    expect(chain.hopCount).toBe(2);
    expect(chain.hops[0].statusCode).toBe(301);
    expect(chain.hops[1].statusCode).toBe(200);
    expect(chain.isShortened).toBe(true);
  });

  it("detects circular redirects (A → B → A)", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { Location: "https://b.com" },
          })
        );
      }
      // B redirects back to the original
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: "https://a.com" },
        })
      );
    });

    const chain = await resolveRedirectChain("https://a.com");
    expect(chain.error).toBe("Circular redirect detected");
  });

  it("blocks redirect to private IP (SSRF protection)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/admin" },
      })
    );

    const chain = await resolveRedirectChain("https://bit.ly/ssrf");
    expect(chain.error).toBe("Redirect to private/internal address blocked");
    // Should have the first hop but not follow the private redirect
    expect(chain.hops).toHaveLength(1);
  });

  it("truncates at max hops", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string) => {
      return Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { Location: `https://hop${Math.random()}.com` },
        })
      );
    });

    const chain = await resolveRedirectChain("https://start.com", {
      maxHops: 3,
    });
    expect(chain.truncated).toBe(true);
    expect(chain.hops.length).toBeLessThanOrEqual(3);
  });

  it("falls back to GET on 405 Method Not Allowed", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      callCount++;
      if (opts.method === "HEAD") {
        return Promise.resolve(new Response(null, { status: 405 }));
      }
      // GET succeeds
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    const chain = await resolveRedirectChain("https://example.com");
    expect(chain.hops[0].statusCode).toBe(200);
    // HEAD + GET = 2 fetch calls
    expect(callCount).toBe(2);
  });

  it("handles fetch error gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const chain = await resolveRedirectChain("https://example.com");
    expect(chain.error).toContain("Fetch failed");
    expect(chain.hops).toHaveLength(0);
  });
});

// ── resolveRedirects ──

describe("resolveRedirects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array for empty input", async () => {
    const result = await resolveRedirects([]);
    expect(result).toEqual([]);
  });

  it("resolves multiple URLs in parallel", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await resolveRedirects([
      "https://a.com",
      "https://b.com",
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].originalUrl).toBe("https://a.com");
    expect(result[1].originalUrl).toBe("https://b.com");
  });
});

// ── extractFinalUrls ──

describe("extractFinalUrls", () => {
  it("returns unique final URLs that differ from originals", () => {
    const chains = [
      {
        originalUrl: "https://bit.ly/a",
        finalUrl: "https://dest-a.com",
        hops: [],
        hopCount: 1,
        isShortened: true,
        hasOpenRedirect: false,
        truncated: false,
      },
      {
        originalUrl: "https://bit.ly/b",
        finalUrl: "https://dest-b.com",
        hops: [],
        hopCount: 1,
        isShortened: true,
        hasOpenRedirect: false,
        truncated: false,
      },
    ];
    const finals = extractFinalUrls(chains);
    expect(finals).toContain("https://dest-a.com");
    expect(finals).toContain("https://dest-b.com");
    expect(finals).toHaveLength(2);
  });

  it("excludes URLs where final equals original", () => {
    const chains = [
      {
        originalUrl: "https://example.com",
        finalUrl: "https://example.com",
        hops: [],
        hopCount: 1,
        isShortened: false,
        hasOpenRedirect: false,
        truncated: false,
      },
    ];
    const finals = extractFinalUrls(chains);
    expect(finals).toHaveLength(0);
  });

  it("deduplicates when multiple originals resolve to same final", () => {
    const chains = [
      {
        originalUrl: "https://bit.ly/a",
        finalUrl: "https://same-dest.com",
        hops: [],
        hopCount: 1,
        isShortened: true,
        hasOpenRedirect: false,
        truncated: false,
      },
      {
        originalUrl: "https://bit.ly/b",
        finalUrl: "https://same-dest.com",
        hops: [],
        hopCount: 1,
        isShortened: true,
        hasOpenRedirect: false,
        truncated: false,
      },
    ];
    const finals = extractFinalUrls(chains);
    expect(finals).toEqual(["https://same-dest.com"]);
  });
});
