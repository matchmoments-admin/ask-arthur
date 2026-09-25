import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@askarthur/scam-engine/ssrf-dispatcher", () => ({ ssrfSafeDispatcher: {} }));

import { checkSecurityTxt } from "../checks/security-txt";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("checkSecurityTxt", () => {
  it("a 204 is an empty file (warn: no Contact), not a failed check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const r = await checkSecurityTxt("https://shop.example/");
    expect(r.status).toBe("warn");
  });

  it("a 404 is skipped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    expect((await checkSecurityTxt("https://shop.example/")).status).toBe("skipped");
  });

  it("a valid file passes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Contact: mailto:sec@shop.example\nExpires: 2030-01-01T00:00:00Z\n")),
    );
    expect((await checkSecurityTxt("https://shop.example/")).status).toBe("pass");
  });
});
