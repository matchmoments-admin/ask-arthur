import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@askarthur/scam-engine/ssrf-dispatcher", () => ({ ssrfSafeDispatcher: {} }));

import { GET } from "@/app/api/feed/proxy-image/route";

const call = (u: string) =>
  GET(new NextRequest(`https://askarthur.au/api/feed/proxy-image?url=${encodeURIComponent(u)}`));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/feed/proxy-image", () => {
  it("serves an allowlisted image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })));
    const res = await call("https://i.redd.it/a.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([300, 304, 305])("an upstream %i is a 502, never passed through", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    const res = await call("https://i.redd.it/a.png");
    expect(res.status).toBe(502);
  });

  it("a 302 with no Location is a 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302 })));
    const res = await call("https://i.redd.it/a.png");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Redirect with no location" });
  });

  it("an upstream 404 keeps its status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect((await call("https://i.redd.it/a.png")).status).toBe(404);
  });

  it("refuses a non-image from its headers before reading the body", async () => {
    let pulled = false;
    const body = new ReadableStream(
      {
        pull(c) {
          pulled = true;
          c.enqueue(new Uint8Array(8));
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "text/html" } })));
    const res = await call("https://i.redd.it/a.png");
    expect(res.status).toBe(400);
    expect(pulled).toBe(false);
  });

  it("an empty upstream body is a 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200, headers: { "content-type": "image/png" } })));
    expect((await call("https://i.redd.it/a.png")).status).toBe(502);
  });

  it("a redirect off the allowlist is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x.png" } })));
    expect((await call("https://i.redd.it/a.png")).status).toBe(403);
  });
});
