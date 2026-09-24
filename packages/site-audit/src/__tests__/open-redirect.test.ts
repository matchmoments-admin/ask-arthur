import { beforeEach, describe, expect, it, vi } from "vitest";
import { ssrfSafeDispatcher } from "@askarthur/scam-engine/ssrf-dispatcher";
import { checkOpenRedirect } from "../checks/open-redirect";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("checkOpenRedirect", () => {
  it("sends every probe through the SSRF-safe dispatcher", async () => {
    await checkOpenRedirect("https://site.example/");
    expect(mockFetch).toHaveBeenCalled();
    for (const [, init] of mockFetch.mock.calls) {
      expect((init as { dispatcher?: unknown }).dispatcher).toBe(ssrfSafeDispatcher);
      expect((init as { redirect?: string }).redirect).toBe("manual");
    }
  });

  it("flags a parameter that redirects off-site", async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes("next=")
        ? new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } })
        : new Response(null, { status: 200 }),
    );
    const r = await checkOpenRedirect("https://site.example/");
    expect(JSON.stringify(r)).toContain("next");
  });
});
