import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCandidateLive,
  probeLiveness,
  probeLivenessDetailed,
  probeLivenessVerdict,
} from "@/lib/clone-watch/liveness";

// v248 — the probe is three-valued: true = proved serving, false = proved gone
// (NXDOMAIN only), null = inconclusive. isCandidateLive keeps the conservative
// boolean view (live === true) so auto-triage's auto-confirm bar is unchanged.
// Every test injects resolveGone so no case touches a live resolver.

const GONE = { resolveGone: async () => true };
const RESOLVES = { resolveGone: async () => false };

/** Node surfaces transport failures as `TypeError: fetch failed` with the real
 *  error on `.cause` — mirror that shape so errorCodeOf is exercised properly. */
function transportError(code: string): Error {
  const cause = Object.assign(new Error(code), { code });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeLivenessVerdict", () => {
  it("treats any HTTP status < 500 as proved live", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    expect(await probeLivenessVerdict("https://up.example/")).toEqual({
      live: true,
      reason: "http",
      status: 403,
    });
  });

  it("treats a 5xx as inconclusive, not dead — reachable but not serving", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    const v = await probeLivenessVerdict("https://5xx.example/");
    expect(v.live).toBeNull();
    expect(v.status).toBe(502);
  });

  // The regression that lost 13 issue-reporter batches in July 2026:
  // targetshopp.cc serves a live phish behind a hostname-mismatched cert, so
  // strict-TLS fetch throws. The old probe read that as death.
  it("falls back to http:// on a TLS error and reports live when it answers", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        if (String(url).startsWith("https:")) {
          throw transportError("ERR_TLS_CERT_ALTNAME_INVALID");
        }
        return new Response("", { status: 404 });
      }),
    );
    expect(await probeLivenessVerdict("https://badcert.example/")).toEqual({
      live: true,
      reason: "tls_http_fallback",
      status: 404,
    });
    expect(seen[1]).toBe("http://badcert.example/");
  });

  it("never calls a TLS failure dead even when the http fallback also fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw transportError("CERT_HAS_EXPIRED");
      }),
    );
    // A completed TLS handshake attempt proves a live socket — DNS is not even
    // consulted, so a `resolveGone` that would say "gone" must not win.
    expect(await probeLivenessVerdict("https://expired.example/", GONE)).toEqual(
      { live: null, reason: "tls" },
    );
  });

  it("treats a refused connection as inconclusive without consulting DNS", async () => {
    const resolveGone = vi.fn(async () => true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw transportError("ECONNREFUSED");
      }),
    );
    expect(
      await probeLivenessVerdict("https://blocked.example/", { resolveGone }),
    ).toEqual({ live: null, reason: "refused" });
    // An RST proves the name resolved; asking DNS would be wasted latency.
    expect(resolveGone).not.toHaveBeenCalled();
  });

  it("treats a timeout as inconclusive when the name still resolves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }),
    );
    expect(
      await probeLivenessVerdict("https://slow.example/", RESOLVES),
    ).toEqual({ live: null, reason: "timeout" });
  });

  it("is dead only when the name has no A and no NS record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw transportError("ENOTFOUND");
      }),
    );
    expect(await probeLivenessVerdict("https://gone.example/", GONE)).toEqual({
      live: false,
      reason: "nxdomain",
    });
  });

  it("reads an inconclusive resolver error as inconclusive, never dead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw transportError("ENOTFOUND");
      }),
    );
    const v = await probeLivenessVerdict("https://unknown.example/", {
      resolveGone: async () => null,
    });
    expect(v.live).toBeNull();
  });
});

describe("isCandidateLive", () => {
  it("keeps the conservative bar: only a proved-live host is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("up")) return new Response("", { status: 403 });
        if (String(url).includes("5xx")) return new Response("", { status: 502 });
        throw transportError("ECONNREFUSED");
      }),
    );
    expect(await isCandidateLive("https://up.example/")).toBe(true);
    // Inconclusive reads as false here — auto-triage must not auto-confirm on a
    // host it could not actually read.
    expect(await isCandidateLive("https://5xx.example/")).toBe(false);
    expect(await isCandidateLive("https://dead.example/", GONE)).toBe(false);
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

describe("probeLivenessDetailed", () => {
  it("carries the reason through so drain stamps stay diagnosable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));
    const map = await probeLivenessDetailed(["https://a.example/"]);
    expect(map.get("https://a.example/")).toEqual({
      live: true,
      reason: "http",
      status: 200,
    });
  });
});
