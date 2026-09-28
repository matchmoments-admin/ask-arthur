import { describe, expect, it } from "vitest";
import {
  CLONE_WATCH_PARKING_NS,
  DOMAIN_INTEL_PARKING_NS,
  PARKING_LANDING_HOSTS,
  hostUnder,
} from "@askarthur/scam-engine/parking-providers";
import {
  livenessVerdictOf,
  readDomainDnsState,
  submitPrecheckOf,
  sweepDomainDns,
  type DnsAnswers,
  type DnsProbe,
} from "@/lib/clone-watch/liveness";
import { stockStatus } from "@/lib/clone-watch/clone-metrics";
import { dnsFingerprint, readRecheckDns } from "@/lib/clone-watch/recheck-dns-gate";
import { readWeaponisedLiveness } from "@/lib/clone-watch/weaponised-liveness";
import { probeChunk, type StockRow } from "@/lib/clone-watch/month-end-stock";
import { ATTRIBUTIONS, DNS_FIXTURES } from "./fixtures/domain-dns-fixtures";
import BASELINE from "./fixtures/domain-dns-baseline.json";

/**
 * Domain DNS State (liveness.ts) — one probe, one state, every DNS verdict a
 * reading of it (PR-A of the clone-watch deepening plan, 2026-09-28).
 *
 * THE PIN. `fixtures/domain-dns-baseline.json` was captured by running the
 * ORIGIN/MAIN code (7794cf03: classifyDnsLookups, classifyHostLookups,
 * classifySubmitPrecheck, stockStatus with its own parking list and hold
 * detector, dnsFingerprint + isOpaqueProbe with their own error codes and IPv6
 * parser) over `fixtures/domain-dns-fixtures.ts`. Every reading here must
 * equal it, except the weaponised sweep's stored verdict, whose intended
 * changes are listed in SWEEP_DELTAS — all from "present means an address":
 *   1. a name that exists and ANSWERED with no address is `no_host`, no
 *      longer `present` (the defect);
 *   2. A failed but AAAA has a record is `present`, no longer `inconclusive`
 *      (an address exists — review L1 of #1284);
 *   3. A NODATA with the AAAA read failed is `inconclusive`, no longer
 *      `present` — the address was never checked (review L2 of #1284).
 * The baseline was re-captured from 7794cf03 when `a_fail_aaaa_record` was
 * added; every earlier fixture's entry came back identical.
 *
 * GO-RED (2026-09-28; each: edit the named line, run this file, see the
 * named tests fail, restore):
 *   - livenessVerdictOf: return "present" whenever gone === false (drop the
 *     hasAddress bar) → "the sweep verdict" (the no_host fixtures), "NS without an
 *     address reads no_host EVERYWHERE" and "the weaponised sweep sends
 *     verdict…" fail (6).
 *   - readDomainDnsState: presence "resolves" on gone === false instead of
 *     hasAddress → "month-end stock", "only an address exits dead-dormancy",
 *     "index-aligned…" and "no_host EVERYWHERE" fail (7).
 *   - isParkingNameserver matching nothing → "month-end stock" fails on the
 *     parked fixtures (3).
 *   - isDnsAnswer always true → "the recheck fingerprint and opacity" fails
 *     on servfail / timeout / the mixed-failure fixtures (5).
 *   - ipv6Groups without the `::` expansion → the whole file fails at import:
 *     SHARED_FRONT_RANGES' 2606:4700::/32 no longer parses (loud, by design).
 *   - sweepDomainDns: fill an expired target's slot with an unverified state
 *     → "index-aligned, reads a throw as unverified, and stops at the budget"
 *     fails (1).
 *   - probeChunk: dead-dormancy exit on gone === false instead of an address
 *     → "only an address exits dead-dormancy" fails (1).
 * Review round (#1284), each also red then restored:
 *   - L2 reverted (`no_host` on gone === false alone, dropping the
 *     hasAddress === false bar) → "A NODATA + AAAA timeout is inconclusive",
 *     "every presence maps to exactly the verdicts…" and "the sweep verdict"
 *     fail (3).
 *   - L1 reverted (`present` only when also gone === false) → "every presence
 *     maps…" and "the sweep verdict" (a_fail_aaaa_record) fail (2).
 */

const SWEEP_DELTAS: Record<string, string> = {
  ns_no_address: "no_host",
  ns_no_address_empty: "no_host",
  parked_no_address: "no_host",
  a_fail_aaaa_record: "present",
  a_nodata_aaaa_timeout: "inconclusive",
};

type Baseline = Record<
  string,
  {
    gone: boolean | null;
    hasAddress: boolean | null;
    precheck: string;
    sweepVerdict: string;
    fingerprint: string | null;
    opaque: boolean;
    stock: Record<string, string>;
  }
>;
const baseline = BASELINE as Baseline;
const names = Object.keys(DNS_FIXTURES);

describe("the baseline covers every fixture", () => {
  it("was captured for exactly these fixtures", () => {
    expect(Object.keys(baseline).sort()).toEqual([...names].sort());
  });
});

describe.each(names)("%s", (name) => {
  const dns = DNS_FIXTURES[name]!;
  const was = baseline[name]!;
  const state = readDomainDnsState(dns);

  it("gone and hasAddress are the old isDomainGone / resolvesToHost", () => {
    expect(state.gone).toBe(was.gone);
    expect(state.hasAddress).toBe(was.hasAddress);
  });

  it("the submit precheck", () => {
    expect(submitPrecheckOf(state)).toBe(was.precheck);
  });

  it("the recheck fingerprint and opacity", () => {
    expect(dnsFingerprint(state.dns)).toBe(was.fingerprint);
    expect(state.opaque).toBe(was.opaque);
  });

  it("month-end stock, under every stored attribution / lifecycle / urlscan", () => {
    for (const [an, attribution] of Object.entries(ATTRIBUTIONS)) {
      for (const lifecycle_state of ["monitoring", "weaponised"]) {
        for (const urlscan_classification of [null, "parked_for_sale"]) {
          const key = `${an}|${lifecycle_state}|${urlscan_classification}`;
          expect(
            stockStatus({ dns, attribution, lifecycle_state, urlscan_classification }),
            key,
          ).toBe(was.stock[key]);
        }
      }
    }
  });

  it("the sweep verdict (intended changes: SWEEP_DELTAS)", () => {
    expect(livenessVerdictOf(state)).toBe(SWEEP_DELTAS[name] ?? was.sweepVerdict);
  });
});

describe("NS without an address reads no_host EVERYWHERE", () => {
  const dns = DNS_FIXTURES.ns_no_address!;
  const state = readDomainDnsState(dns);
  it("state, stock, precheck and sweep agree", () => {
    expect(state.presence).toBe("no_host");
    expect(stockStatus({ dns })).toBe("no_host");
    expect(submitPrecheckOf(state)).toBe("no_host");
    expect(livenessVerdictOf(state)).toBe("no_host");
    expect(state.hasAddress).toBe(false); // re-emergence: not back
  });
});

describe("no_host needs the address ANSWERED, not merely unproven (review L2)", () => {
  it("A NODATA + AAAA timeout is inconclusive, never no_host", () => {
    // An IPv6-only phish whose AAAA read flaked: the name exists (gone false)
    // but the address was never checked (hasAddress null).
    const state = readDomainDnsState(DNS_FIXTURES.a_nodata_aaaa_timeout!);
    expect([state.gone, state.hasAddress]).toEqual([false, null]);
    expect(livenessVerdictOf(state)).toBe("inconclusive");
  });
  it("every presence maps to exactly the verdicts its doc comment lists", () => {
    const seen = new Set<string>();
    for (const dns of Object.values(DNS_FIXTURES)) {
      const s = readDomainDnsState(dns);
      seen.add(`${s.presence}->${livenessVerdictOf(s)}`);
    }
    expect([...seen].sort()).toEqual([
      "gone->gone",
      "no_host->inconclusive", // A+AAAA NXDOMAIN, NS failed
      "no_host->no_host",
      "resolves->present",
      "unverified->inconclusive",
    ]);
  });
});

describe("one parking table, each reader's set unchanged", () => {
  // The three literal lists as they stood on main (7794cf03).
  const OLD_CLONE_WATCH_NS = [
    "afternic.com", "dns-parking.com", "sedoparking.com", "parkingcrew.net",
    "bodis.com", "abovedomains.com", "above.com", "aftermarket.pl",
    "namebrightdns.com", "dan.com", "undeveloped.com",
  ];
  const OLD_LANDING = [
    "afternic.com", "sedo.com", "sedoparking.com", "dan.com", "parkingcrew.net",
    "bodis.com", "uniregistry.com", "undeveloped.com", "domainmarket.com",
    "namebright.com",
  ];
  const OLD_DOMAIN_INTEL = [
    "sedoparking.com", "parkingcrew.net", "bodis.com", "domaincontrol.com",
    "above.com", "parklogic.com", "undeveloped.com",
  ];
  const set = (xs: readonly string[]) => [...new Set(xs)].sort();

  it("the clone-watch nameserver reading = old NS roots ∪ landing hosts", () => {
    expect(set(CLONE_WATCH_PARKING_NS)).toEqual(set([...OLD_CLONE_WATCH_NS, ...OLD_LANDING]));
  });
  it("the landing-host reading = old PARKED_HOST_PATTERNS", () => {
    expect(set(PARKING_LANDING_HOSTS)).toEqual(set(OLD_LANDING));
  });
  it("the domain-intel reading = old PARKING_NS_PATTERNS", () => {
    expect(set(DOMAIN_INTEL_PARKING_NS)).toEqual(set(OLD_DOMAIN_INTEL));
  });
  it("matches by DNS label, never by substring", () => {
    expect(hostUnder("ns1.afternic.com.", PARKING_LANDING_HOSTS)).toBe(true);
    expect(hostUnder("evilafternic.com", PARKING_LANDING_HOSTS)).toBe(false);
    expect(hostUnder("afternic.com.attacker.com", PARKING_LANDING_HOSTS)).toBe(false);
  });
});

// ── The one sweep: all three callers go through sweepDomainDns ─────────────

const fake = (byHost: Record<string, DnsAnswers | null | "throw">): DnsProbe =>
  async (host) => {
    const v = byHost[host];
    if (v === "throw") throw new Error("resolver exploded");
    return v ?? null;
  };

describe("the one sweep", () => {
  const probe = fake({
    "up.example": DNS_FIXTURES.resolves!,
    "nsonly.example": DNS_FIXTURES.ns_no_address!,
    "boom.example": "throw",
  });
  const targets = ["up.example", "nsonly.example", "boom.example"];

  it("is index-aligned, reads a throw as unverified, and stops at the budget", async () => {
    const all = await sweepDomainDns(targets, (t) => t, { expired: () => false, probe });
    expect(all.states.map((s) => s?.presence)).toEqual(["resolves", "no_host", "unverified"]);
    expect(all.unreached).toBe(0);
    let n = 0;
    const cut = await sweepDomainDns(targets, (t) => t, {
      expired: () => n++ >= 1,
      probe,
      concurrency: 1,
    });
    expect(cut.states.map((s) => s?.presence ?? null)).toEqual(["resolves", null, null]);
    expect(cut.unreached).toBe(2);
  });

  it("the weaponised sweep sends verdict, gone and hold from the one state", async () => {
    const r = await readWeaponisedLiveness(
      targets.map((candidate_domain, i) => ({
        id: i + 1,
        candidate_domain,
        whois_statuses: i === 1 ? ["client hold"] : [],
      })),
      { expired: () => false },
      probe,
    );
    expect(r.reads).toEqual([
      { id: 1, verdict: "present", gone: false, hold: false },
      { id: 2, verdict: "no_host", gone: false, hold: true },
      { id: 3, verdict: "inconclusive", gone: null, hold: false },
    ]);
  });

  it("an old list RPC (no whois_statuses) sends hold: null so the SQL regex decides", async () => {
    const r = await readWeaponisedLiveness(
      [{ id: 1, candidate_domain: "up.example" }],
      { expired: () => false },
      probe,
    );
    expect(r.reads[0]!.hold).toBeNull();
  });

  it("the recheck gate reads its fingerprint from the one state", async () => {
    const r = await readRecheckDns(
      targets.map((candidate_domain, i) => ({ id: i + 1, candidate_domain })),
      { expired: () => false },
      probe,
    );
    expect(r.reads.map((x) => [x.id, x.verdict])).toEqual([
      [1, "no_baseline"],
      [2, "no_baseline"],
      [3, "unknown"],
    ]);
  });

  it("month-end stock reads the one state, and only an address exits dead-dormancy", async () => {
    const row = (id: number, candidate_domain: string): StockRow => ({
      id,
      candidate_domain,
      inferred_target_domain: "brand.example",
      attribution: null,
      urlscan_classification: null,
      lifecycle_state: "monitoring",
      // v326 dead-dormant: eight urlscan 400s running.
      urlscan_uuid: null,
      urlscan_failure_streak: 8,
      urlscan_evidence: { status: 400 },
    });
    const res = await probeChunk({
      ids: [1, 2, 3],
      rows: [row(1, "up.example"), row(2, "nsonly.example"), row(3, "boom.example")],
      periodMonth: "2026-09-01",
      probe,
      expired: () => false,
    });
    expect(res.snapshots.map((s) => s.status)).toEqual(["live", "no_host", "unverified"]);
    expect(res.dormantResolving).toEqual([1]);
    expect(res.handled).toBe(3);
  });
});
