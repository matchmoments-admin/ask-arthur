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

/** A minimal non-redirect Response stub. */
function htmlResponse(text: string, opts?: { status?: number; ok?: boolean }) {
  return {
    ok: opts?.ok ?? true,
    status: opts?.status ?? 200,
    body: streamOf(text),
    // Final responses never have their headers read by fetchShopPage, but
    // include a stub so the shape matches a real Response.
    headers: { get: () => null },
  };
}

/** A 3xx Response stub carrying a (case-insensitive) Location header. */
function redirectResponse(location: string | null, status = 302) {
  return {
    ok: false,
    status,
    body: null,
    headers: {
      get: (h: string) => (h.toLowerCase() === "location" ? location : null),
    },
  };
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
      vi.fn(async () => htmlResponse("<html><body>hello shop</body></html>")),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBeNull();
    expect(res.html).toContain("hello shop");
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe("https://shop.example.com/");
  });

  it("caps the response body size", async () => {
    const huge = "x".repeat(600 * 1024);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(huge)),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.html).not.toBeNull();
    expect(res.html!.length).toBeLessThanOrEqual(512 * 1024);
  });

  it("returns an http error for a non-OK response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse("", { ok: false, status: 404 })),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("http-404");
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

  it("follows a public multi-hop redirect chain to the final page", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://shop.example.com/step-2"))
      .mockResolvedValueOnce(redirectResponse("https://shop.example.com/final"))
      .mockResolvedValueOnce(htmlResponse("<html>final shop</html>"));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBeNull();
    expect(res.html).toContain("final shop");
    expect(res.finalUrl).toBe("https://shop.example.com/final");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("resolves a relative redirect Location against the current URL", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("/landing"))
      .mockResolvedValueOnce(htmlResponse("<html>landing</html>"));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await fetchShopPage("https://shop.example.com/start");
    expect(res.error).toBeNull();
    expect(res.finalUrl).toBe("https://shop.example.com/landing");
    expect(res.html).toContain("landing");
  });

  it("blocks a redirect whose Location points straight at a private host", async () => {
    const fetchSpy = vi.fn(async () =>
      redirectResponse("http://192.168.0.1/internal"),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("blocked-private-redirect");
    expect(res.html).toBeNull();
    // The private host is validated from the Location header and never fetched.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a private host that appears mid redirect chain", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://cdn.example.com/r"))
      .mockResolvedValueOnce(
        redirectResponse("http://169.254.169.254/latest/meta-data"),
      );
    vi.stubGlobal("fetch", fetchSpy);
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("blocked-private-redirect");
    // Two public hops fetched; the metadata host is never contacted.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after too many redirects", async () => {
    const fetchSpy = vi.fn(async () =>
      redirectResponse("https://shop.example.com/loop"),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("too-many-redirects");
    expect(res.html).toBeNull();
    // Initial fetch + MAX_REDIRECTS (5) followed hops = 6.
    expect(fetchSpy).toHaveBeenCalledTimes(6);
  });

  it("errors when a redirect carries no Location header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => redirectResponse(null)),
    );
    const res = await fetchShopPage("https://shop.example.com/");
    expect(res.error).toBe("redirect-no-location");
    expect(res.html).toBeNull();
  });
});
