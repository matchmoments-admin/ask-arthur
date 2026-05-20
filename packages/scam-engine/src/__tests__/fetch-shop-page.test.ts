import { describe, expect, it, vi, afterEach } from "vitest";

import { fetchShopPage } from "../fetch-shop-page";

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchShopPage", () => {
  it("blocks a private/internal URL before fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await fetchShopPage("http://localhost/admin");
    expect(res.error).toBe("blocked-private-url");
    expect(res.html).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks loopback and metadata IPs", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await fetchShopPage("http://127.0.0.1/")).error).toBe(
      "blocked-private-url",
    );
    expect((await fetchShopPage("http://169.254.169.254/")).error).toBe(
      "blocked-private-url",
    );
  });

  it("returns decoded HTML on a successful fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://shop.example.com/",
        body: streamOf("<html><body>hello shop</body></html>"),
      })),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBeNull();
    expect(res.html).toContain("hello shop");
    expect(res.status).toBe(200);
  });

  it("caps the response body size", async () => {
    const huge = "x".repeat(600 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "https://shop.example.com/",
        body: streamOf(huge),
      })),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.html).not.toBeNull();
    expect(res.html!.length).toBeLessThanOrEqual(512 * 1024);
  });

  it("returns an http error for a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        url: "https://shop.example.com/",
        body: streamOf(""),
      })),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("http-404");
    expect(res.html).toBeNull();
  });

  it("blocks a redirect that lands on a private host", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        url: "http://192.168.0.1/",
        body: streamOf("<html></html>"),
      })),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("blocked-private-redirect");
    expect(res.html).toBeNull();
  });

  it("returns a timeout error when the fetch aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("timeout");
    expect(res.html).toBeNull();
  });
});
