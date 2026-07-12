import { afterEach, describe, expect, it, vi } from "vitest";
import { isCandidateLive, probeLiveness } from "@/lib/clone-watch/liveness";

// The probe treats any HTTP status < 500 as live (401/403/404 = host is up);
// network errors / timeouts / 5xx read as dead. Never throws.

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isCandidateLive", () => {
  it("status < 500 is live; 5xx and network errors are dead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("up")) return new Response("", { status: 403 });
        if (String(url).includes("5xx")) return new Response("", { status: 502 });
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await isCandidateLive("https://up.example/")).toBe(true);
    expect(await isCandidateLive("https://5xx.example/")).toBe(false);
    expect(await isCandidateLive("https://dead.example/")).toBe(false);
  });
});

describe("probeLiveness", () => {
  it("probes each unique URL once and maps url → live", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return new Response("", {
          status: String(url).includes("dead") ? 503 : 200,
        });
      }),
    );
    const map = await probeLiveness([
      "https://a.example/",
      "https://dead.example/",
      "https://a.example/", // duplicate — probed once
    ]);
    expect(map.get("https://a.example/")).toBe(true);
    expect(map.get("https://dead.example/")).toBe(false);
    expect(seen.filter((u) => u === "https://a.example/")).toHaveLength(1);
  });

  it("bounds concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return new Response("", { status: 200 });
      }),
    );
    const urls = Array.from({ length: 10 }, (_, i) => `https://u${i}.example/`);
    await probeLiveness(urls, 2);
    expect(peak).toBeLessThanOrEqual(2);
  });
});
