import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDnsLookups,
  classifyHostLookups,
  classifySubmitPrecheck,
  isCandidateLive,
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

describe("probeLivenessDetailed", () => {
  it("probes each unique URL once", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        return new Response("", {
          status: String(url).includes("err") ? 503 : 200,
        });
      }),
    );
    const map = await probeLivenessDetailed([
      "https://a.example/",
      "https://err.example/",
      "https://a.example/", // duplicate — probed once
    ]);
    expect(map.get("https://a.example/")?.live).toBe(true);
    // 5xx is reachable-but-not-serving: inconclusive, never dead.
    expect(map.get("https://err.example/")?.live).toBeNull();
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
    await probeLivenessDetailed(urls, 2);
    expect(peak).toBeLessThanOrEqual(2);
  });

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

// ── DNS three-valued logic (v/PR7) ──────────────────────────────────────────
// These drive classifyDnsLookups directly. Every OTHER test in this file
// injects `resolveGone`, so until now nothing exercised the real resolver
// path — which is exactly how a SERVFAIL-reads-as-dead bug survived the
// 2026-07-26 "only NXDOMAIN counts as dead" rewrite one layer above it.
describe("classifyDnsLookups (only absence proves deadness)", () => {
  const abort = () => {
    throw new Error("NS lookup should not have run");
  };

  it("A records present → alive, without querying NS", () => {
    expect(classifyDnsLookups({ records: ["1.2.3.4"] }, abort)).toBe(false);
  });

  it("NS records present → alive even with no A record", () => {
    expect(
      classifyDnsLookups({ errorCode: "ENODATA" }, () => ({ records: ["ns1.x"] })),
    ).toBe(false);
  });

  it("both lookups prove absence → gone", () => {
    expect(
      classifyDnsLookups({ errorCode: "ENOTFOUND" }, () => ({ errorCode: "ENOTFOUND" })),
    ).toBe(true);
  });

  it("empty NS array with an absent A → gone", () => {
    expect(
      classifyDnsLookups({ errorCode: "ENOTFOUND" }, () => ({ records: [] })),
    ).toBe(true);
  });

  // The regression. Each of these used to return `true` (gone) because both
  // resolver calls were `.catch(() => [])`.
  it.each(["SERVFAIL", "REFUSED", "ETIMEOUT", "ECONNREFUSED", "UNKNOWN"])(
    "%s on the A lookup is inconclusive, never dead",
    (code) => {
      expect(classifyDnsLookups({ errorCode: code }, abort)).toBeNull();
    },
  );

  it.each(["SERVFAIL", "REFUSED", "ETIMEOUT"])(
    "%s on the NS lookup is inconclusive, never dead",
    (code) => {
      expect(
        classifyDnsLookups({ errorCode: "ENOTFOUND" }, () => ({ errorCode: code })),
      ).toBeNull();
    },
  );

  it("an empty A record array is not absence on its own", () => {
    // No error code means the query succeeded; an empty answer still has to be
    // confirmed against NS rather than read as deadness.
    expect(classifyDnsLookups({ records: [] }, () => ({ records: ["ns1.x"] }))).toBe(
      false,
    );
  });
});

// ── ENODATA is NODATA, not NXDOMAIN (PR B, 2026-09-23) ──────────────────────
// c-ares reports "the name exists but has no record of this type" as ENODATA.
// It was in the absent-set, so a delegated name with no A and a subdomain with
// no NS read as GONE — lifecycle deadness must be NXDOMAIN-class only.
describe("classifyDnsLookups — ENODATA proves the name exists", () => {
  const abort = () => {
    throw new Error("NS lookup should not have run");
  };
  it("ENODATA on A → not gone, without querying NS", () => {
    expect(classifyDnsLookups({ errorCode: "ENODATA" }, abort)).toBe(false);
  });
  it("ENODATA on NS → not gone", () => {
    expect(
      classifyDnsLookups({ errorCode: "ENOTFOUND" }, () => ({ errorCode: "ENODATA" })),
    ).toBe(false);
  });
});

// "Does this name resolve to a host?" — the scanning / re-emergence question.
// A delegated zone with NS but no A/AAAA answers urlscan "400 DNS Error"
// (prod: sucway.net, apple.co.mw, amazom.yoga) and is not a re-emergence.
describe("classifyHostLookups (A or AAAA present)", () => {
  const abort = () => {
    throw new Error("AAAA lookup should not have run");
  };
  it("an A record → a host, without querying AAAA", () => {
    expect(classifyHostLookups({ records: ["1.2.3.4"] }, abort)).toBe(true);
  });
  it("AAAA only → a host", () => {
    expect(classifyHostLookups({ errorCode: "ENODATA" }, () => ({ records: ["::1"] }))).toBe(
      true,
    );
  });
  it.each([
    [{ errorCode: "ENODATA" }, { errorCode: "ENODATA" }],
    [{ errorCode: "ENOTFOUND" }, { errorCode: "ENOTFOUND" }],
    [{ records: [] }, { errorCode: "ENODATA" }],
  ])("no A and no AAAA answered → no host (%j, %j)", (a, aaaa) => {
    expect(classifyHostLookups(a, () => aaaa)).toBe(false);
  });
  it.each(["SERVFAIL", "REFUSED", "ETIMEOUT"])(
    "%s on either lookup is inconclusive",
    (code) => {
      expect(classifyHostLookups({ errorCode: code }, () => ({ errorCode: "ENODATA" }))).toBeNull();
      expect(classifyHostLookups({ errorCode: "ENODATA" }, () => ({ errorCode: code }))).toBeNull();
    },
  );
  it("a failed A lookup still accepts an AAAA answer", () => {
    expect(classifyHostLookups({ errorCode: "SERVFAIL" }, () => ({ records: ["::1"] }))).toBe(
      true,
    );
  });
});

// The urlscan SUBMIT precheck (2026-09-25). SERVFAIL may skip a scan — every
// SERVFAIL name measured in prod was also refused by urlscan — but it must
// never leak into the lifecycle verdict (classifyDnsLookups above keeps
// SERVFAIL inconclusive, the PR 7 lesson).
describe("classifySubmitPrecheck", () => {
  const rec = (...r: string[]) => ({ records: r });
  const err = (errorCode: string) => ({ errorCode });
  it.each([
    ["A record", rec("1.2.3.4"), err("ESERVFAIL"), "host"],
    ["AAAA record only", err("ESERVFAIL"), rec("::1"), "host"],
    ["NODATA + NXDOMAIN", err("ENODATA"), err("ENOTFOUND"), "no_host"],
    ["SERVFAIL + SERVFAIL", err("ESERVFAIL"), err("ESERVFAIL"), "servfail"],
    ["SERVFAIL + NODATA", err("ESERVFAIL"), err("ENODATA"), "servfail"],
    ["NXDOMAIN + SERVFAIL", err("ENOTFOUND"), err("ESERVFAIL"), "servfail"],
    ["empty answer + SERVFAIL", rec(), err("ESERVFAIL"), "servfail"],
    ["SERVFAIL + TIMEOUT", err("ESERVFAIL"), err("ETIMEOUT"), "unknown"],
    ["TIMEOUT + TIMEOUT", err("ETIMEOUT"), err("ETIMEOUT"), "unknown"],
    ["REFUSED + SERVFAIL", err("EREFUSED"), err("ESERVFAIL"), "unknown"],
  ])("%s → %s", (_label, a, aaaa, want) => {
    expect(classifySubmitPrecheck(a, () => aaaa)).toBe(want);
  });

  it("SERVFAIL still proves nothing for the lifecycle verdict", () => {
    expect(classifyDnsLookups(err("ESERVFAIL"), () => err("ESERVFAIL"))).toBeNull();
    expect(classifyHostLookups(err("ESERVFAIL"), () => err("ESERVFAIL"))).toBeNull();
  });
});

// Candidate URLs are attacker-registered and the probe follows redirects, so
// every fetch must go through the SSRF-safe dispatcher.
describe("probeLivenessVerdict — outbound guard", () => {
  it("fetches through the SSRF-safe dispatcher", async () => {
    const { ssrfSafeDispatcher } = await import("@askarthur/scam-engine/ssrf-dispatcher");
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await probeLivenessVerdict("https://up.example/", RESOLVES);
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { dispatcher?: unknown };
    expect(init.dispatcher).toBe(ssrfSafeDispatcher);
  });
});
