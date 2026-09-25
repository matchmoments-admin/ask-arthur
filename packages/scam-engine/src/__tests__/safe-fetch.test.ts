import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { Agent, buildConnector } from "undici";
import { safeFetch } from "../safe-fetch";
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

  it("no Location → redirects/no-location; manual mode returns the 3xx; error mode refuses", async () => {
    const impl = routes({ "https://a.example/": () => new Response(null, { status: 302 }) });
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, fetchImpl: impl }))
      .toMatchObject({ ok: false, reason: "redirects", detail: "no-location" });
    const impl2 = routes({ "https://a.example/": redirect("https://b.example/") });
    const manual = await safeFetch("https://a.example/", { timeoutMs: 1000, as: "none", redirect: "manual", fetchImpl: impl2 });
    expect(manual).toMatchObject({ ok: true, status: 302 });
    if (manual.ok) expect(manual.headers.get("location")).toBe("https://b.example/");
    expect(await safeFetch("https://a.example/", { timeoutMs: 1000, maxBytes: 10, redirect: "error", fetchImpl: impl2 }))
      .toMatchObject({ ok: false, reason: "redirects", detail: "redirect-refused" });
  });
});

describe("safeFetch — body", () => {
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
