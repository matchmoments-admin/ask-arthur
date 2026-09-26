import { describe, expect, it } from "vitest";

import {
  planUrlscanRechecks,
  type SliceRow,
} from "@/app/api/inngest/functions/clone-watch-lifecycle-recheck";
import {
  dnsFingerprint,
  gateVerdict,
  isUrlscanFloorDue,
  readRecheckDns,
  type DnsRead,
} from "@/lib/clone-watch/recheck-dns-gate";

/**
 * Recheck DNS Gate (v334, #1229 part 2a) — the pure half: fingerprint, verdict,
 * floor and the per-run urlscan plan. The SQL half (queue clock, stamp,
 * baseline write) is recheckWorklistSql.test.ts.
 *
 * Go-red record (2026-09-27), each change made, run, reverted:
 *   - dnsFingerprint: map an inconclusive code (ESERVFAIL) to "" like an
 *     answer → "SERVFAIL / timeout make the whole fingerprint unknown" fails.
 *     This is the fail-toward-scanning guarantee.
 *   - dnsFingerprint: drop the `.sort()` → "record order never reads as a
 *     change" fails.
 *   - dnsFingerprint: keep full IPv4 addresses (no /24) → the Hostinger and
 *     Vercel rotation cases fail.
 *   - fingerprintsMatch: exact address equality instead of overlap → the
 *     Afternic-anycast and Vercel cases fail (read as "changed" = a wasted
 *     urlscan every run).
 *   - fingerprintsMatch: drop the `b.ns === o.ns` term → "any NS change is a
 *     change" fails.
 *   - isUrlscanFloorDue: use oldFloorDays for young rows → "a young row is
 *     floor-due at 7 days" fails.
 *   - planUrlscanRechecks: stamp floor-due unchanged rows as unchanged (drop
 *     `&& !floorDue`) → "an unchanged row that is floor-due is still scanned"
 *     and the stale-floor reserve case both fail.
 *   - planUrlscanRechecks: let a DNS-unreached row into the scan regardless of
 *     floor (drop the `!read && !floorDue` skip) → "a row DNS never reached is
 *     scanned only when floor-due" fails.
 *   - isUrlscanFloorDue with the young floor replaced by the old one also
 *     fails the two planner floor cases (they rely on the 7-day floor).
 *   - planUrlscanRechecks: select from one risk-ordered list (no changed-first
 *     tier) → "CHANGED rows win the cap over higher-risk unknown rows" fails.
 *   - readRecheckDns: map a thrown probe to the baseline → "a probe that throws
 *     reads unknown" fails.
 */

const NOW = Date.parse("2026-09-27T06:30:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString();

const rec = (records: string[]) => ({ records });
const err = (errorCode: string) => ({ errorCode });

describe("dnsFingerprint", () => {
  it("is order-, case- and trailing-dot-insensitive", () => {
    const a = dnsFingerprint({
      a: rec(["2.2.2.2", "1.1.1.1"]),
      aaaa: null,
      ns: rec(["NS2.Host.com.", "ns1.host.com"]),
    });
    const b = dnsFingerprint({
      a: rec(["1.1.1.1", "2.2.2.2", "1.1.1.1"]),
      aaaa: null,
      ns: rec(["ns1.host.com", "ns2.host.com"]),
    });
    expect(a).toBe(b);
    expect(a).toBe(
      "v1|a=1.1.1.0/24,2.2.2.0/24|aaaa=-|ns=ns1.host.com,ns2.host.com",
    );
  });

  it("record order never reads as a change", () => {
    const x = dnsFingerprint({
      a: rec(["9.9.9.9", "8.8.8.8"]),
      aaaa: null,
      ns: rec(["b", "a"]),
    });
    const y = dnsFingerprint({
      a: rec(["8.8.8.8", "9.9.9.9"]),
      aaaa: null,
      ns: rec(["a", "b"]),
    });
    expect(x).toBe(y);
  });

  it("reduces IPv6 to its /48, expanding ::", () => {
    expect(
      dnsFingerprint({
        a: err("ENODATA"),
        aaaa: rec(["2A02:4780:0048:b0ae::1", "2406:da1e::7"]),
        ns: rec(["n"]),
      }),
    ).toBe("v1|a=|aaaa=2406:da1e:0::/48,2a02:4780:48::/48|ns=n");
  });
});

// Measured 2026-09-26 on 400 due pool names read twice 11 minutes apart: 15
// exact-string fingerprints "changed" with nothing real happening — anycast
// pairs answering one member or both, Hostinger parking returning a fresh
// address inside the same /24 and /48 on every query, Vercel rotating inside
// 216.150.1.0/24 + 216.150.16.0/24. Every fixture below is one of those.
describe("gateVerdict — rotation is not a change; a move is", () => {
  const fp = (a: string[], ns: string[], aaaa: string[] | null = null) =>
    dnsFingerprint({
      a: a.length ? rec(a) : err("ENODATA"),
      aaaa: aaaa ? rec(aaaa) : null,
      ns: rec(ns),
    })!;
  it("Afternic anycast answering one member of its pair", () => {
    const ns = ["ns1.afternic.com", "ns2.afternic.com"];
    expect(
      gateVerdict(
        fp(["13.248.169.48", "76.223.54.146"], ns),
        fp(["76.223.54.146"], ns),
      ),
    ).toBe("unchanged");
  });
  it("Hostinger parking rotating inside its /24 and /48 on every read", () => {
    const ns = ["byte.dns-parking.com", "pixel.dns-parking.com"];
    const first = fp(["37.98.151.233", "91.108.99.45"], ns, [
      "2a02:4780:48:b0ae:ec69:96:a4cd:daa9",
    ]);
    const again = fp(["37.98.151.120", "91.108.99.173"], ns, [
      "2a02:4780:48:fcdb:9f5:1360:ed18:484",
    ]);
    expect(gateVerdict(first, again)).toBe("unchanged");
  });
  it("Vercel moving between its two /24s", () => {
    const ns = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];
    expect(
      gateVerdict(
        fp(["216.150.1.129", "216.150.1.65"], ns),
        fp(["216.150.1.193", "216.150.16.1"], ns),
      ),
    ).toBe("unchanged");
  });
  it("parked → hosted on a different network is a change", () => {
    const ns = ["ns1.afternic.com", "ns2.afternic.com"];
    expect(
      gateVerdict(
        fp(["13.248.169.48", "76.223.54.146"], ns),
        fp(["185.199.110.153"], ns),
      ),
    ).toBe("changed");
  });
  it("any NS change is a change, even on the same addresses", () => {
    expect(
      gateVerdict(
        fp(["1.2.3.4"], ["ns1.parking.example"]),
        fp(["1.2.3.4"], ["ns1.cloudflare.com"]),
      ),
    ).toBe("changed");
  });
  it("gaining or losing all addresses is a change", () => {
    expect(gateVerdict(fp([], ["n"]), fp(["1.2.3.4"], ["n"]))).toBe("changed");
    expect(gateVerdict(fp(["1.2.3.4"], ["n"]), fp([], ["n"]))).toBe("changed");
  });
  it("an unparseable or other-version baseline is a change (fail toward scanning)", () => {
    const now = fp(["1.2.3.4"], ["n"]);
    expect(gateVerdict("garbage", now)).toBe("changed");
    expect(gateVerdict(now.replace(/^v1/, "v0"), now)).toBe("changed");
  });
});

describe("dnsFingerprint — answers and failures", () => {
  it("treats NXDOMAIN / NODATA as an answer (stable empty part)", () => {
    expect(
      dnsFingerprint({
        a: err("ENODATA"),
        aaaa: err("ENOTFOUND"),
        ns: err("ENOTFOUND"),
      }),
    ).toBe("v1|a=|aaaa=|ns=");
  });

  it("SERVFAIL / timeout make the whole fingerprint unknown", () => {
    for (const code of ["ESERVFAIL", "ETIMEOUT", "ECONNREFUSED", "UNKNOWN"]) {
      expect(
        dnsFingerprint({ a: rec(["1.1.1.1"]), aaaa: null, ns: err(code) }),
      ).toBeNull();
      expect(
        dnsFingerprint({ a: err(code), aaaa: rec([]), ns: rec(["ns"]) }),
      ).toBeNull();
    }
    expect(dnsFingerprint(null)).toBeNull();
  });

  it("a parked name gaining a hosting A record is a change (raw lookups)", () => {
    const parked = dnsFingerprint({
      a: err("ENODATA"),
      aaaa: err("ENODATA"),
      ns: rec(["ns1.parking.example"]),
    });
    const hosted = dnsFingerprint({
      a: rec(["203.0.113.7"]),
      aaaa: null,
      ns: rec(["ns1.parking.example"]),
    });
    expect(gateVerdict(parked, hosted)).toBe("changed");
  });
});

describe("gateVerdict", () => {
  it("unknown beats everything; no baseline next; then the match", () => {
    const x = "v1|a=1.1.1.0/24|aaaa=-|ns=n";
    const y = "v1|a=9.9.9.0/24|aaaa=-|ns=n";
    expect(gateVerdict(x, null)).toBe("unknown");
    expect(gateVerdict(null, null)).toBe("unknown");
    expect(gateVerdict(null, x)).toBe("no_baseline");
    expect(gateVerdict(undefined, x)).toBe("no_baseline");
    expect(gateVerdict(x, x)).toBe("unchanged");
    expect(gateVerdict(x, y)).toBe("changed");
  });
});

describe("isUrlscanFloorDue", () => {
  const row = (lastDays: number | null, ageDays: number | null) => ({
    last_rechecked_at: lastDays === null ? null : daysAgo(lastDays),
    first_seen_at: ageDays === null ? null : daysAgo(ageDays),
  });
  it("a young row (< 14 days) is floor-due at 7 days", () => {
    expect(isUrlscanFloorDue(row(6.9, 10), NOW)).toBe(false);
    expect(isUrlscanFloorDue(row(7, 10), NOW)).toBe(true);
  });
  it("an older row is floor-due at 30 days", () => {
    expect(isUrlscanFloorDue(row(8, 20), NOW)).toBe(false);
    expect(isUrlscanFloorDue(row(29.9, 60), NOW)).toBe(false);
    expect(isUrlscanFloorDue(row(30, 60), NOW)).toBe(true);
  });
  it("fails toward scanning on a missing clock or age", () => {
    expect(isUrlscanFloorDue(row(null, 10), NOW)).toBe(true);
    expect(isUrlscanFloorDue(row(1, null), NOW)).toBe(true);
    expect(
      isUrlscanFloorDue(
        { last_rechecked_at: "garbage", first_seen_at: daysAgo(3) },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("readRecheckDns", () => {
  const targets = [
    {
      id: 1,
      candidate_domain: "a.example",
      recheck_dns_fingerprint: "v1|a=1.1.1.0/24|aaaa=-|ns=n",
    },
    { id: 2, candidate_domain: "b.example", recheck_dns_fingerprint: null },
  ];
  it("a probe that throws reads unknown, never unchanged", async () => {
    const out = await readRecheckDns(
      targets,
      { expired: () => false },
      async () => {
        throw new Error("resolver down");
      },
    );
    expect(out.reads.map((r) => r.verdict)).toEqual(["unknown", "unknown"]);
    expect(out.unreached).toBe(0);
  });
  it("compares against each row's baseline", async () => {
    const out = await readRecheckDns(
      targets,
      { expired: () => false },
      async () => ({
        a: rec(["1.1.1.1"]),
        aaaa: null,
        ns: rec(["n"]),
      }),
    );
    expect(out.reads.find((r) => r.id === 1)?.verdict).toBe("unchanged");
    expect(out.reads.find((r) => r.id === 2)?.verdict).toBe("no_baseline");
  });
  it("counts rows an expired budget never reached", async () => {
    const out = await readRecheckDns(
      targets,
      { expired: () => true },
      async () => null,
    );
    expect(out.reads).toEqual([]);
    expect(out.unreached).toBe(2);
  });
});

describe("planUrlscanRechecks", () => {
  // Young (10 d) rows rescanned 1 day ago: NOT floor-due unless overridden.
  const row = (id: number, over: Partial<SliceRow> = {}): SliceRow => ({
    id,
    candidate_domain: `c${id}.example`,
    candidate_url: `https://c${id}.example`,
    lifecycle_state: "declined",
    last_rechecked_at: daysAgo(1),
    first_seen_at: daysAgo(10),
    recheck_dns_fingerprint: "fp",
    risk: 10,
    ...over,
  });
  const read = (id: number, verdict: DnsRead["verdict"]): DnsRead => ({
    id,
    verdict,
    fingerprint: verdict === "unknown" ? null : "fp",
  });

  it("skips and stamps an unchanged, not-floor-due row", () => {
    const p = planUrlscanRechecks([row(1)], [read(1, "unchanged")], 90, NOW);
    expect(p.scan).toEqual([]);
    expect(p.unchangedIds).toEqual([1]);
    expect(p.counts).toMatchObject({
      dns_checked: 1,
      dns_unchanged: 1,
      floor_due: 0,
      deferred: 0,
    });
  });

  it("an unchanged row that is floor-due is still scanned, and not stamped", () => {
    const p = planUrlscanRechecks(
      [row(1, { last_rechecked_at: daysAgo(8) })],
      [read(1, "unchanged")],
      90,
      NOW,
    );
    expect(p.scan.map((r) => r.id)).toEqual([1]);
    expect(p.unchangedIds).toEqual([]);
    expect(p.counts).toMatchObject({ dns_unchanged: 0, floor_due: 1 });
  });

  it("scans changed, unknown and no-baseline rows", () => {
    const p = planUrlscanRechecks(
      [row(1), row(2), row(3)],
      [read(1, "changed"), read(2, "unknown"), read(3, "no_baseline")],
      90,
      NOW,
    );
    expect(p.scan.map((r) => r.id).sort()).toEqual([1, 2, 3]);
    expect(p.unchangedIds).toEqual([]);
    expect(p.counts).toMatchObject({
      dns_changed: 1,
      dns_unknown: 1,
      dns_no_baseline: 1,
    });
  });

  it("a row DNS never reached is scanned only when floor-due, and never stamped", () => {
    const p = planUrlscanRechecks(
      [row(1), row(2, { last_rechecked_at: daysAgo(9) })],
      [],
      90,
      NOW,
    );
    expect(p.scan.map((r) => r.id)).toEqual([2]);
    expect(p.unchangedIds).toEqual([]);
    expect(p.counts.dns_checked).toBe(0);
  });

  it("CHANGED rows win the cap over higher-risk unknown rows, and lead the order", () => {
    const slice = [
      row(1, { risk: 90 }),
      row(2, { risk: 80 }),
      row(3, { risk: 5 }),
      row(4, { risk: 4 }),
    ];
    const p = planUrlscanRechecks(
      slice,
      [
        read(1, "unknown"),
        read(2, "unknown"),
        read(3, "changed"),
        read(4, "changed"),
      ],
      2,
      NOW,
    );
    expect(p.scan.map((r) => r.id)).toEqual([3, 4]);
    expect(p.counts.deferred).toBe(2);
  });

  it("keeps the stale-floor reserve on the urlscan clock inside the remaining slots", () => {
    // 10 fresh high-risk unknowns, one low-risk floor-due row rescanned 25 d ago
    // on an old alert. limit 5 → reserve floor(5 * 0.2) = 1 slot for the stalest.
    const hot = Array.from({ length: 10 }, (_, i) =>
      row(i + 1, { risk: 90 - i }),
    );
    const stale = row(99, {
      risk: 0,
      last_rechecked_at: daysAgo(31),
      first_seen_at: daysAgo(60),
    });
    const p = planUrlscanRechecks(
      [...hot, stale],
      [...hot.map((r) => read(r.id, "unknown")), read(99, "unchanged")],
      5,
      NOW,
    );
    expect(p.scan.map((r) => r.id)).toContain(99);
    expect(p.scan).toHaveLength(5);
  });

  it("an all-unchanged run scans nothing and stamps everything it read", () => {
    const slice = Array.from({ length: 50 }, (_, i) => row(i + 1));
    const p = planUrlscanRechecks(
      slice,
      slice.map((r) => read(r.id, "unchanged")),
      90,
      NOW,
    );
    expect(p.scan).toEqual([]);
    expect(p.unchangedIds).toHaveLength(50);
    expect(p.counts).toMatchObject({
      dns_checked: 50,
      dns_unchanged: 50,
      deferred: 0,
    });
  });
});
