import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetch as undiciFetch } from "undici";
import { ssrfSafeDispatcher } from "../ssrf-dispatcher";

// The dispatcher's DNS `lookup` hook is never called when the URL host is
// already an IP literal (Node's net.connect skips resolution). The connect
// layer must therefore check IP-literal hosts itself — directly and after a
// followed redirect.

let server: Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/target` });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("internal");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("ssrfSafeDispatcher — IP-literal hosts", () => {
  it("refuses a loopback IP literal", async () => {
    hits = 0;
    await expect(
      undiciFetch(`http://127.0.0.1:${port}/`, { dispatcher: ssrfSafeDispatcher }),
    ).rejects.toThrow();
    expect(hits).toBe(0);
  });

  it("refuses a redirect to an IP literal", async () => {
    // The first hop is itself a literal here (a test server can only bind
    // locally), so this pins that EVERY connect — including each redirect hop —
    // goes through the literal check.
    hits = 0;
    await expect(
      undiciFetch(`http://127.0.0.1:${port}/redirect`, {
        dispatcher: ssrfSafeDispatcher,
        redirect: "follow",
      }),
    ).rejects.toThrow();
    expect(hits).toBe(0);
  });

  it.each(["::1", "169.254.169.254", "10.0.0.1", "::ffff:127.0.0.1"])(
    "the connector rejects %s with EPRIVATEHOST before dialling",
    async (ip) => {
      const { buildSsrfConnector } = await import("../ssrf-dispatcher");
      let dialled = false;
      const connect = buildSsrfConnector(((_o: unknown, cb: (e: null, s: null) => void) => {
        dialled = true;
        cb(null, null);
      }) as never);
      const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
        connect(
          { hostname: ip.includes(":") ? `[${ip}]` : ip, host: ip, protocol: "http:", port: "80" } as never,
          ((e: NodeJS.ErrnoException | null) => resolve(e)) as never,
        ),
      );
      expect(err?.code).toBe("EPRIVATEHOST");
      expect(dialled).toBe(false);
    },
  );

  it("passes a public IP literal through to the real connector", async () => {
    const { buildSsrfConnector } = await import("../ssrf-dispatcher");
    let dialled = false;
    const connect = buildSsrfConnector(((_o: unknown, cb: (e: null, s: null) => void) => {
      dialled = true;
      cb(null, null);
    }) as never);
    await new Promise<void>((resolve) =>
      connect(
        { hostname: "93.184.216.34", host: "93.184.216.34", protocol: "http:", port: "80" } as never,
        (() => resolve()) as never,
      ),
    );
    expect(dialled).toBe(true);
  });
});
