import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRedirectChain } from "../checks/redirect-chain";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function mockResponse(status: number, headers: Record<string, string> = {}) {
  return {
    status,
    headers: new Headers(headers),
  };
}

describe("checkRedirectChain", () => {
  it("passes with no redirects (direct URL)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));

    const { check, chain } = await checkRedirectChain("https://example.com");
    expect(check.status).toBe("pass");
    expect(check.score).toBe(5);
    expect(chain).toHaveLength(1);
    expect(chain[0].statusCode).toBe(200);
  });

  it("passes with 1 same-domain redirect", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/new" })
      )
      .mockResolvedValueOnce(mockResponse(200));

    const { check, chain } = await checkRedirectChain("https://example.com/old");
    expect(check.status).toBe("pass");
    expect(check.score).toBe(5);
    expect(chain).toHaveLength(2);
  });

  it("warns with cross-domain redirect", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse(302, { location: "https://other-site.com/page" })
      )
      .mockResolvedValueOnce(mockResponse(200));

    const { check, chain } = await checkRedirectChain("https://example.com");
    expect(check.status).toBe("warn");
    expect(check.score).toBe(3);
    expect(chain).toHaveLength(2);
    expect(check.details).toContain("2 domains");
  });

  it("warns with 2-3 redirects", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/a" })
      )
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/b" })
      )
      .mockResolvedValueOnce(mockResponse(200));

    const { check, chain } = await checkRedirectChain("https://example.com");
    expect(check.status).toBe("warn");
    expect(check.score).toBe(3);
    expect(chain).toHaveLength(3);
  });

  it("fails with 4+ redirects", async () => {
    mockFetch
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/a" })
      )
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/b" })
      )
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/c" })
      )
      .mockResolvedValueOnce(
        mockResponse(301, { location: "https://example.com/d" })
      )
      .mockResolvedValueOnce(mockResponse(200));

    const { check, chain } = await checkRedirectChain("https://example.com");
    expect(check.status).toBe("fail");
    expect(check.score).toBe(0);
    expect(chain).toHaveLength(5);
    expect(check.details).toContain("4 redirects");
  });

  it("returns error when fetch fails on first request", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { check, chain } = await checkRedirectChain("https://example.com");
    expect(check.status).toBe("error");
    expect(check.score).toBe(0);
    expect(chain).toHaveLength(0);
  });

  it("records server header in chain hops", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(200, { server: "nginx/1.21" })
    );

    const { chain } = await checkRedirectChain("https://example.com");
    expect(chain[0].server).toBe("nginx/1.21");
  });

  it("has correct metadata", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200));

    const { check } = await checkRedirectChain("https://example.com");
    expect(check.id).toBe("redirect-chain");
    expect(check.category).toBe("content");
    expect(check.maxScore).toBe(5);
  });
});
