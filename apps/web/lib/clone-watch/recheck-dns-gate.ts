import type { BudgetClock } from "@askarthur/scam-engine/inngest/step-budget";
import { mapWithConcurrency } from "@askarthur/utils/concurrency";
import { probeStockDns, type DnsLookup } from "@/lib/clone-watch/liveness";

/**
 * Recheck DNS Gate (v334, #1229 part 2a) — a free DNS fingerprint decides
 * whether a due recheck row is worth a urlscan rescan.
 *
 * WHY. The recheck lane's designed cadence asks for ~3,800 urlscan rescans a
 * day; urlscan's unlisted quota is 1,000/day and the lane spends 360 of it
 * (measured 2026-09-26: 90/run, due_total 1,354–1,441). Most due rows have not
 * changed since their last rescan, and a phishing kit going live almost always
 * moves DNS — a parked name gains a hosting A record, NS moves off the
 * registrar's parking servers. Reading that is a few resolver queries, not a
 * scan.
 *
 * WHAT IT DECIDES, per row the lane offers:
 *   - unchanged    — fingerprint MATCHES the baseline taken at the last rescan
 *                    (same NS, overlapping /24 + /48 — fingerprintsMatch):
 *                    skip urlscan, stamp the DNS clock (the row moves back in
 *                    the queue). Unless FLOOR-due.
 *   - changed      — differs from the baseline: urlscan.
 *   - unknown      — a query SERVFAILed / timed out / was refused: urlscan
 *                    (the gate fails toward scanning, never toward skipping).
 *   - no_baseline  — never rescanned since v334: urlscan (the rescan sets it).
 *   - floor-due    — orthogonal: a mandatory rescan however DNS reads, so a
 *                    flip that does NOT move DNS (content swapped on the same
 *                    host) is still seen in bounded time. See URLSCAN_FLOOR.
 *
 * DNS ONLY, REUSED. The lookups are liveness.ts `probeStockDns` (A, AAAA only
 * when A has none, always NS) — the month-end stock probe; this module adds no
 * resolver code. The weaponised liveness sweep (v329) asks a different
 * question of DNS ("is the name gone?" — `isDomainGone`), so it is reused in
 * shape (budgeted, bounded-concurrency read, never throws) rather than in
 * function. Weaponisation itself stays urlscan-only.
 *
 * Pure except `readRecheckDns`, which takes its probe as a parameter.
 */

export const RECHECK_DNS = {
  /** Rows DNS-read per run (of the up-to-1,000 fetched). 600 x 4 runs =
   *  2,400/day against a ~3,800/day cadence demand; `due_total` shows the
   *  remainder. */
  limit: 600,
  /** DNS reads in flight. 400 names at 16 measured ~25 s from a laptop
   *  (2026-09-26, three parallel queries each); 24 keeps 600 in ~the same. */
  concurrency: 24,
  /** Wall clock the DNS phase may spend of the lane's single in-step budget,
   *  leaving the rest (>= 130 s) for the paced urlscan batch (90 x 1.1 s). */
  phaseMs: 90_000,
} as const;

/**
 * Mandatory urlscan rescan regardless of DNS. From the 66 decline→weaponise
 * flips measured for #1229: 26 within 7 days, 13 in days 7–14, 22 in days
 * 14–45, 5 after 45.
 *   - Under 14 days old: 39 of 66 flips (59%) land here, ~2.8/day across the
 *     cohort — the densest window. A 7-day floor caps a DNS-invisible flip's
 *     latency at a week while the hazard is highest.
 *   - 14 days and older: 27 flips spread over the next 76 days (~0.36/day). A
 *     30-day floor gives every row in the 14–90-day window at least two
 *     unconditional rescans.
 * DNS-VISIBLE flips are caught at the DNS cadence (6 h, 24 h past 45 days),
 * which is the point of the gate; the floor only bounds the invisible kind.
 */
export const URLSCAN_FLOOR = {
  youngAgeDays: 14,
  youngFloorDays: 7,
  oldFloorDays: 30,
} as const;

/** Fingerprint format version. Bumping it makes every stored baseline read as
 *  "changed" — one rescan wave, never a silent false "unchanged". */
export const DNS_FINGERPRINT_VERSION = "v1";

export type DnsGateVerdict =
  | "unchanged"
  | "changed"
  | "unknown"
  | "no_baseline";

/**
 * Resolver codes that are an ANSWER (the name is absent, or has no record of
 * this type) and so are part of a stable fingerprint. Everything else —
 * SERVFAIL, REFUSED, TIMEOUT, connection errors, UNKNOWN — proves nothing and
 * makes the whole fingerprint unknown. Same classes as liveness.ts
 * NAME_ABSENT_CODES + NO_DATA_CODE.
 */
const ANSWER_CODES = new Set(["ENOTFOUND", "NOTFOUND", "NXDOMAIN", "ENODATA"]);

/** IPv4 → its /24. Parking and anycast pools answer a random member of a
 *  /24 on every query (Hostinger's dns-parking.com: a fresh 37.98.151.x and
 *  91.108.99.x each read), so a full address is not a stable fingerprint. */
function v4Prefix(ip: string): string | null {
  const o = ip.split(".");
  if (o.length !== 4 || o.some((x) => !/^\d{1,3}$/.test(x))) return null;
  return `${o[0]}.${o[1]}.${o[2]}.0/24`;
}

/** IPv6 → its /48 (first three hextets, zero-expanded, leading zeros
 *  stripped). Same reason as v4Prefix — the Hostinger pool rotates the low
 *  64 bits per query. */
function v6Prefix(ip: string): string | null {
  const s = ip.toLowerCase().split("%")[0]!;
  if (!s.includes(":")) return null;
  const [head, tail] = s.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const groups =
    tail === undefined
      ? h
      : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  if (
    groups.length < 3 ||
    groups.slice(0, 3).some((g) => !/^[0-9a-f]{1,4}$/.test(g))
  )
    return null;
  return `${groups
    .slice(0, 3)
    .map((g) => g.replace(/^0+(?=.)/, ""))
    .join(":")}::/48`;
}

type Kind = "a" | "aaaa" | "ns";

function normalise(kind: Kind, record: string): string | null {
  const r = record.trim().toLowerCase().replace(/\.$/, "");
  if (!r) return null;
  if (kind === "a") return v4Prefix(r) ?? r;
  if (kind === "aaaa") return v6Prefix(r) ?? r;
  return r;
}

function part(kind: Kind, l: DnsLookup): string | null {
  if ("records" in l) {
    return [
      ...new Set(
        l.records
          .map((r) => normalise(kind, r))
          .filter((x): x is string => !!x),
      ),
    ]
      .sort()
      .join(",");
  }
  return ANSWER_CODES.has(l.errorCode) ? "" : null;
}

/**
 * The fingerprint of one probe, or null when any query was inconclusive (or the
 * probe itself failed). Addresses are reduced to their /24 or /48 and every
 * part is sorted and de-duplicated, so record ORDER and pool rotation never
 * read as a change. AAAA is "-" when A had records (probeStockDns skips it);
 * that is stable across reads, and if A disappears the A part changes anyway.
 *
 *   v1|a=13.248.169.0/24,76.223.54.0/24|aaaa=-|ns=ns1.afternic.com,ns2.afternic.com
 */
export function dnsFingerprint(
  probe: { a: DnsLookup; aaaa: DnsLookup | null; ns: DnsLookup } | null,
): string | null {
  if (!probe) return null;
  const a = part("a", probe.a);
  const aaaa = probe.aaaa === null ? "-" : part("aaaa", probe.aaaa);
  const ns = part("ns", probe.ns);
  if (a === null || aaaa === null || ns === null) return null;
  return `${DNS_FINGERPRINT_VERSION}|a=${a}|aaaa=${aaaa}|ns=${ns}`;
}

function parseFingerprint(
  fp: string,
): { version: string; a: string; aaaa: string; ns: string } | null {
  const m = /^([^|]+)\|a=([^|]*)\|aaaa=([^|]*)\|ns=([^|]*)$/.exec(fp);
  return m ? { version: m[1]!, a: m[2]!, aaaa: m[3]!, ns: m[4]! } : null;
}

/** Address parts match when both are empty, or they share at least one
 *  prefix. Overlap, not equality: an anycast pair answers one member or both
 *  (measured 2026-09-26: 9 of 400 sampled names flipped between {x,y} and {y}
 *  inside 11 minutes, e.g. Afternic's 13.248.169.48 / 76.223.54.146). A kit
 *  going live moves to a DIFFERENT network — no overlap. "-" (not queried)
 *  matches only "-". */
function addressesMatch(x: string, y: string): boolean {
  if (x === "-" || y === "-") return x === y;
  const X = x ? x.split(",") : [];
  const Y = y ? y.split(",") : [];
  if (X.length === 0 || Y.length === 0) return X.length === Y.length;
  const ys = new Set(Y);
  return X.some((p) => ys.has(p));
}

/**
 * Same DNS as the baseline? NS must be IDENTICAL (a delegation moving off the
 * registrar's parking servers is the strongest go-live signal there is, and NS
 * sets do not rotate); A and AAAA must overlap at /24 and /48. An unparseable
 * baseline or a version mismatch is "not the same" — the gate fails toward
 * scanning.
 */
export function fingerprintsMatch(baseline: string, observed: string): boolean {
  const b = parseFingerprint(baseline);
  const o = parseFingerprint(observed);
  if (!b || !o || b.version !== o.version) return false;
  return (
    b.ns === o.ns && addressesMatch(b.a, o.a) && addressesMatch(b.aaaa, o.aaaa)
  );
}

/** Compare an observed fingerprint with the stored baseline. */
export function gateVerdict(
  baseline: string | null | undefined,
  observed: string | null,
): DnsGateVerdict {
  if (observed === null) return "unknown";
  if (!baseline) return "no_baseline";
  return fingerprintsMatch(baseline, observed) ? "unchanged" : "changed";
}

/**
 * Is this row due a mandatory urlscan rescan? Keys on `last_rechecked_at` —
 * the URLSCAN recheck clock, which a DNS read never moves. A row never
 * rescanned, or with an unreadable clock or age, is floor-due: fail toward
 * scanning.
 */
export function isUrlscanFloorDue(
  row: { last_rechecked_at: string | null; first_seen_at?: string | null },
  nowMs: number,
): boolean {
  const last = row.last_rechecked_at ? Date.parse(row.last_rechecked_at) : NaN;
  const seen = row.first_seen_at ? Date.parse(row.first_seen_at) : NaN;
  if (!Number.isFinite(last) || !Number.isFinite(seen)) return true;
  const DAY = 86_400_000;
  const young = nowMs - seen < URLSCAN_FLOOR.youngAgeDays * DAY;
  const floorDays = young
    ? URLSCAN_FLOOR.youngFloorDays
    : URLSCAN_FLOOR.oldFloorDays;
  return nowMs - last >= floorDays * DAY;
}

export interface DnsRead {
  id: number;
  /** null = inconclusive. */
  fingerprint: string | null;
  verdict: DnsGateVerdict;
}

/**
 * DNS-read each target until the budget expires, `concurrency` in flight. A
 * probe that throws reads as unknown — never as unchanged. Targets the budget
 * stopped before are counted, not read; they stay due.
 */
export async function readRecheckDns(
  targets: readonly {
    id: number;
    candidate_domain: string;
    recheck_dns_fingerprint?: string | null;
  }[],
  budget: Pick<BudgetClock, "expired">,
  probe: (
    host: string,
  ) => Promise<Parameters<typeof dnsFingerprint>[0]> = probeStockDns,
  concurrency: number = RECHECK_DNS.concurrency,
): Promise<{ reads: DnsRead[]; unreached: number }> {
  const reads: DnsRead[] = [];
  let unreached = 0;
  await mapWithConcurrency(targets, concurrency, async (t) => {
    if (budget.expired()) {
      unreached++;
      return;
    }
    let fingerprint: string | null;
    try {
      fingerprint = dnsFingerprint(await probe(t.candidate_domain));
    } catch {
      fingerprint = null;
    }
    reads.push({
      id: t.id,
      fingerprint,
      verdict: gateVerdict(t.recheck_dns_fingerprint, fingerprint),
    });
  });
  return { reads, unreached };
}
