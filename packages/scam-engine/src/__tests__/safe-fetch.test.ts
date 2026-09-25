import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { Agent, buildConnector } from "undici";
import { FETCH_DEFAULT_MAX_REDIRECTS, safeFetch, sameOriginOrUpgrade } from "../safe-fetch";
import { buildSsrfConnector, buildSsrfLookup } from "../ssrf-dispatcher";

// The Interface is the test surface: every case goes through safeFetch().

type FetchImpl = typeof fetch;

/** A fetchImpl answering from a URL → Response table (no network). */
function routes(table: Record<string, () => Response>): FetchImpl & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const make = table[url];
    if (!make) throw new TypeError(`no route for ${url}`);
    return make();
  }) as FetchImpl & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const redirect = (to: string, status = 302) => () =>
  new Response(null, { status, headers: { location: to } });
const text = (body: string, status = 200, headers: Record<string, string> = {}) => () =>
  new Response(body, { status, headers });
/** A body that arrives in chunks with no Content-Length (chunked). */
const chunked = (chunks: number, size: number) => () =>
  new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(size).fill(97));
        c.close();
      },
    }),
    { status: 200 },
  );

describe("safeFetch — guard", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::ffff:7f00:1]/",
    "http://2130706433/",
    "http://localhost/",
    "http://metadata.google.internal/",
    "http://instance-data/",
    "http://localhost./",
    "http://metadata.google.internal./",
    "http://instance-data./",
    "http://localhost../",
    "file:///etc/passwd",
  ])("refuses %s before any request", async (url) => {
    const impl = routes({});
    const r = await safeFetch(url, { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("blocked");
      expect(r.detail).toBe("private-url");
    }
    expect(impl.calls).toEqual([]);
  });

  it("refuses a redirect to a private host WITHOUT requesting it", async () => {
    const impl = routes({ "https://a.example/": redirect("http://169.254.169.254/") });
    const r = await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, reason: "blocked", detail: "private-redirect" });
    expect(impl.calls).toEqual(["https://a.example/"]);
  });

  it("enforces allowHosts on the initial URL and every hop", async () => {
    const allow = new Set(["a.example"]);
    const impl = routes({ "https://a.example/": redirect("https://b.example/") });
    const r = await safeFetch("https://a.example/", {
      timeoutMs: 1000,
      maxBytes: 10,
      allowHosts: allow,
      fetchImpl: impl,
    });
    expect(r).toMatchObject({ ok: false, reason: "blocked", detail: "host-not-allowed" });
    const r2 = await safeFetch("https://c.example/", { timeoutMs: 1000, maxBytes: 10, allowHosts: allow, fetchImpl: impl });
    expect(r2).toMatchObject({ ok: false, reason: "blocked", detail: "host-not-allowed" });
  });

  it("refuses a name whose DNS answer includes a private IP (real dispatcher, stubbed resolver)", async () => {
    const lookup = buildSsrfLookup(((
      _host: string,
      _opts: unknown,
      cb: (e: null, a: Array<{ address: string; family: number }>) => void,
    ) => cb(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])) as never);
    const dispatcher = new Agent({ connect: buildSsrfConnector(buildConnector({ lookup })) });
    const r = await safeFetch("http://mixed.example/", { timeoutMs: 3000, maxBytes: 10, dispatcher });
    expect(r).toMatchObject({ ok: false, reason: "blocked", detail: "private-host", code: "EPRIVATEHOST" });
    await dispatcher.close();
  });
});

describe("safeFetch — redirects", () => {
  it("follows a checked chain and reports every hop", async () => {
    const impl = routes({
      "https://a.example/": redirect("https://b.example/x", 301),
      "https://b.example/x": redirect("/y", 307),
      "https://b.example/y": text("hello"),
    });
    const r = await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 100, fetchImpl: impl });
    expect(r).toMatchObject({ ok: true, body: "hello", finalUrl: "https://b.example/y", status: 200 });
    if (r.ok) expect(r.hops).toEqual(["https://a.example/", "https://b.example/x", "https://b.example/y"]);
  });

  it("stops at maxRedirects", async () => {
    const table: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) table[`https://a.example/${i}`] = redirect(`https://a.example/${i + 1}`);
    const r = await safeFetch("https://a.example/0", { timeoutMs: 1000, maxBytes: 10, maxRedirects: 3, fetchImpl: routes(table) });
    expect(r).toMatchObject({ ok: false, reason: "redirects", detail: "limit" });
  });

  it("detects a loop", async () => {
    const impl = routes({
      "https://a.example/": redirect("https://b.example/"),
      "https://b.example/": redirect("https://a.example/"),
    });
    const r = await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, reason: "redirects", detail: "loop" });
  });

  it("a 3xx without Location is a final response; manual mode returns the 3xx; error mode refuses", async () => {
    const impl = routes({ "https://a.example/": () => new Response(null, { status: 302 }) });
    // Default okStatus (2xx) → an http failure carrying the status…
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl }))
      .toMatchObject({ ok: false, reason: "http", detail: "http-302", status: 302 });
    // …and a caller that accepts any status (liveness) gets the response.
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, as: "none", okStatus: () => true, fetchImpl: impl }))
      .toMatchObject({ ok: true, status: 302 });
    const impl2 = routes({ "https://a.example/": redirect("https://b.example/") });
    const manual = await safeFetch("https://a.example/", { timeoutMs: 1000, as: "none", redirect: "manual", fetchImpl: impl2 });
    expect(manual).toMatchObject({ ok: true, status: 302 });
    if (manual.ok) expect(manual.headers.get("location")).toBe("https://b.example/");
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, redirect: "error", fetchImpl: impl2 }))
      .toMatchObject({ ok: false, reason: "redirects", detail: "redirect-refused" });
  });
});

describe("safeFetch — redirect hygiene", () => {
  /** Records method, headers and body per request. */
  function recording(table: Record<string, () => Response>) {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: { ...((init?.headers as Record<string, string>) ?? {}) },
        body: init?.body,
      });
      const make = table[String(input)];
      if (!make) throw new TypeError(`no route for ${String(input)}`);
      return make();
    }) as FetchImpl;
    return { impl, seen };
  }

  it.each(["Authorization", "cookie", "Proxy-Authorization"])(
    "refuses %s with follow-checked (programmer error), allows it with error/manual",
    async (h) => {
      const headers = { [h]: "secret" };
      await expect(
        safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, headers, fetchImpl: routes({}) }),
      ).rejects.toThrow(/follow-checked/);
      const ok = routes({ "https://a.example/": text("x") });
      expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, headers, redirect: "error", fetchImpl: ok }))
        .toMatchObject({ ok: true });
    },
  );

  it("a cross-origin 307 drops the body and becomes a GET", async () => {
    const { impl, seen } = recording({
      "https://a.example/hook": redirect("https://b.example/elsewhere", 307),
      "https://b.example/elsewhere": text("ok"),
    });
    await safeFetch("https://a.example/hook", {
      method: "POST", body: "signed", headers: { "x-sig": "1" }, timeoutMs: 1000, maxBytes: 10, fetchImpl: impl,
    });
    expect(seen[1]).toMatchObject({ url: "https://b.example/elsewhere", method: "GET", body: undefined });
  });

  it("a same-origin 307 and an http→https upgrade keep method and body", async () => {
    const { impl, seen } = recording({
      "http://a.example/hook": redirect("https://a.example/hook", 308),
      "https://a.example/hook": redirect("https://a.example/v2", 307),
      "https://a.example/v2": text("ok"),
    });
    await safeFetch("http://a.example/hook", {
      method: "POST", body: "signed", timeoutMs: 1000, maxBytes: 10, fetchImpl: impl,
    });
    expect(seen.map((r) => [r.method, r.body])).toEqual([["POST", "signed"], ["POST", "signed"], ["POST", "signed"]]);
  });

  it("allowRedirect refuses a hop before it is requested", async () => {
    const { impl, seen } = recording({ "https://a.example/": redirect("https://b.example/") });
    const r = await safeFetch("https://a.example/", {
      timeoutMs: 1000, as: "none", allowRedirect: sameOriginOrUpgrade, fetchImpl: impl,
    });
    expect(r).toMatchObject({ ok: false, reason: "redirects", detail: "redirect-refused" });
    expect(seen).toHaveLength(1);
  });

  it("sameOriginOrUpgrade", () => {
    const u = (x: string) => new URL(x);
    expect(sameOriginOrUpgrade(u("https://a.example/x"), u("https://a.example/y"))).toBe(true);
    expect(sameOriginOrUpgrade(u("http://a.example/x"), u("https://a.example/y"))).toBe(true);
    expect(sameOriginOrUpgrade(u("https://a.example/x"), u("http://a.example/y"))).toBe(false);
    expect(sameOriginOrUpgrade(u("http://a.example:8080/x"), u("https://a.example/y"))).toBe(false);
    expect(sameOriginOrUpgrade(u("https://a.example/x"), u("https://sub.a.example/y"))).toBe(false);
  });

  it("FETCH_DEFAULT_MAX_REDIRECTS matches fetch: 20 hops follow, the 21st fails", async () => {
    const chain = (n: number) => {
      const t: Record<string, () => Response> = {};
      for (let i = 0; i < n; i++) t[`https://a.example/${i}`] = redirect(`https://a.example/${i + 1}`);
      t[`https://a.example/${n}`] = text("end");
      return routes(t);
    };
    const opts = { timeoutMs: 1000, maxBytes: 10, maxRedirects: FETCH_DEFAULT_MAX_REDIRECTS };
    expect(await safeFetch("https://a.example/0", { ...opts, fetchImpl: chain(20) })).toMatchObject({ ok: true, body: "end" });
    expect(await safeFetch("https://a.example/0", { ...opts, fetchImpl: chain(21) }))
      .toMatchObject({ ok: false, reason: "redirects", detail: "limit" });
  });
});

describe("safeFetch — body", () => {
  it("a 204 / null body is ok and empty in every body form", async () => {
    const impl = routes({ "https://a.example/": () => new Response(null, { status: 204 }) });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl }))
      .toMatchObject({ ok: true, status: 204, body: "" });
    const bytes = await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, as: "bytes", fetchImpl: impl });
    expect(bytes.ok && bytes.body.byteLength).toBe(0);
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, as: "json", fetchImpl: impl }))
      .toMatchObject({ ok: false, reason: "invalid_json", detail: "empty-body" });
  });

  it("beforeBody refuses from headers without reading a byte", async () => {
    let pulled = false;
    const impl = routes({
      "https://a.example/": () =>
        new Response(
          new ReadableStream({
            pull(c) {
              pulled = true;
              c.enqueue(new Uint8Array(4));
              c.close();
            },
          }, { highWaterMark: 0 }),
          { headers: { "content-type": "text/html" } },
        ),
    });
    const r = await safeFetch("https://a.example/", {
      timeoutMs: 1000,
      maxBytes: 10,
      beforeBody: (_s, h) => (h.get("content-type")?.startsWith("image/") ? undefined : "not-an-image"),
      fetchImpl: impl,
    });
    expect(r).toMatchObject({ ok: false, reason: "rejected", detail: "not-an-image" });
    expect(pulled).toBe(false);
  });

  it("rejects an oversize chunked body (no Content-Length)", async () => {
    const impl = routes({ "https://a.example/": chunked(10, 1000) });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 5000, fetchImpl: impl }))
      .toMatchObject({ ok: false, reason: "too_large" });
  });

  it("truncates instead when asked", async () => {
    const impl = routes({ "https://a.example/": chunked(10, 1000) });
    const r = await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 5000, truncate: true, as: "bytes", fetchImpl: impl });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.byteLength).toBe(5000);
      expect(r.truncated).toBe(true);
    }
  });

  it("rejects early on a declared Content-Length over the cap", async () => {
    const impl = routes({ "https://a.example/": text("x", 200, { "content-length": "999999" }) });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl }))
      .toMatchObject({ ok: false, reason: "too_large" });
  });

  it("non-2xx is http/http-<status> unless okStatus accepts it", async () => {
    const impl = routes({ "https://a.example/": text("nope", 404) });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl }))
      .toMatchObject({ ok: false, reason: "http", detail: "http-404", status: 404 });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, okStatus: () => true, fetchImpl: impl }))
      .toMatchObject({ ok: true, status: 404, body: "nope" });
  });

  it("json parses, and a bad body is invalid_json", async () => {
    const good = routes({ "https://a.example/": text('{"a":1}') });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 100, as: "json", fetchImpl: good }))
      .toMatchObject({ ok: true, body: { a: 1 } });
    const bad = routes({ "https://a.example/": text("<html>") });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 100, as: "json", fetchImpl: bad }))
      .toMatchObject({ ok: false, reason: "invalid_json" });
  });

  it("requires maxBytes unless as is none", async () => {
    await expect(safeFetch("https://a.example/", { timeoutMs: 1000 } as never)).rejects.toThrow(/maxBytes/);
  });
});

describe("safeFetch — timeout", () => {
  it("one budget across the chain: a hanging request times out", async () => {
    const impl = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as FetchImpl;
    const r = await safeFetch("https://a.example/", { timeoutMs: 50, maxBytes: 10, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, reason: "timeout", code: "ABORT_ERR" });
  });

  it("a spent budget times out without issuing a request", async () => {
    const impl = routes({});
    const r = await safeFetch("https://a.example/", { timeoutMs: 0, maxBytes: 10, fetchImpl: impl });
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(impl.calls).toEqual([]);
  });
});

// Real undici against a local server: the cap counts DECODED bytes, so a
// small gzip body that inflates past the cap is still refused.
describe("safeFetch — gzip over a real socket", () => {
  let server: http.Server;
  let port = 0;
  const big = Buffer.alloc(2 * 1024 * 1024, 97); // 2 MB of 'a' → ~2 KB gzipped
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" });
      res.end(zlib.gzipSync(big));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Route a guard-passing hostname to the local server through a plain Agent
  // (the SSRF dispatcher would — correctly — refuse 127.0.0.1).
  const viaLocal: FetchImpl = ((input: RequestInfo | URL, init?: RequestInit) =>
    fetch(String(input).replace("http://gzip.example", `http://127.0.0.1:${port}`), {
      ...init,
      ...({ dispatcher: new Agent() } as Record<string, unknown>),
    })) as FetchImpl;

  it("counts decompressed bytes against the cap", async () => {
    const r = await safeFetch("http://gzip.example/", { timeoutMs: 5000, maxBytes: 64 * 1024, fetchImpl: viaLocal });
    expect(r).toMatchObject({ ok: false, reason: "too_large" });
  });

  it("returns the decoded body under the cap", async () => {
    const r = await safeFetch("http://gzip.example/", { timeoutMs: 5000, maxBytes: 4 * 1024 * 1024, as: "bytes", fetchImpl: viaLocal });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.byteLength).toBe(big.byteLength);
  });
});
