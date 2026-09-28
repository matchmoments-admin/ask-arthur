import { Resolver } from "node:dns/promises";
import { safeFetch } from "@askarthur/scam-engine/safe-fetch";
import {
  CLONE_WATCH_PARKING_NS,
  hostUnder,
} from "@askarthur/scam-engine/parking-providers";
import { mapWithConcurrency } from "@askarthur/utils/concurrency";

/**
 * Clone-watch liveness — the DOMAIN DNS STATE Module plus the HTTP liveness
 * probe.
 *
 * DNS: one probe (`probeDomainDns`, the resolver adapter at the `DnsProbe`
 * seam) → one `DomainDnsState` (`readDomainDnsState`: gone / resolves /
 * no_host / unverified, plus parking NS, registry hold and shared-front
 * opacity) → every DNS verdict is a reading of it: `isDomainGone`,
 * `resolvesToHost`, `submitPrecheckOf`, `livenessVerdictOf` (the weaponised
 * sweep), `stockStatus` (clone-metrics.ts) and the recheck gate's fingerprint
 * (recheck-dns-gate.ts). `sweepDomainDns` is the one budgeted,
 * bounded-concurrency walk the three DNS sweeps share.
 *
 * HTTP: `probeLivenessVerdict` — used by the Netcraft issue reporter (never
 * spend a one-per-submission issue slot on a dead site) and the resubmit lane;
 * its DNS fallback is `isDomainGone`.
 *
 * Moved from clone-watch-auto-triage.ts (F3). Auto-triage retired 2026-09-26
 * (#1230) and took its boolean `isCandidateLive` view with it (no other
 * caller); a caller wanting that conservative bar reads `.live === true`.
 *
 * ── Three-valued, 2026-07-26 ────────────────────────────────────────────────
 * The original probe collapsed EVERY fetch rejection into `false`, so NXDOMAIN,
 * an expired/mismatched TLS cert, a timeout and a refused connection were one
 * indistinguishable "dead". That produced false negatives on live phishing:
 * `targetshopp.cc` (a weaponised, urlscan-confirmed Target lookalike) was
 * drained `dead_at_probe` on 2026-07-23 while serving — its cert has a hostname
 * mismatch, so strict-TLS fetch throws, though `http://` answers 404 and the
 * host is plainly up. Two more (`creditosrevolut.online`, `klarnagram.shop`)
 * were probed dead and then rendered successfully by urlscan hours later.
 * 13 of 19 issue-reporter batches drained on this path in the 10 days to
 * 2026-07-26, producing exactly one filing.
 *
 * The rule now: **only NXDOMAIN counts as dead.** Everything else is `true`
 * (proved serving) or `null` (inconclusive) — "skip this round rather than
 * risk a false verdict". Two DNS questions, one state: `gone` (lifecycle:
 * NXDOMAIN only) and `hasAddress` (scanning, re-emergence and "present": an
 * A/AAAA record). Vercel egress IPs are routinely blocked by phishing kits, so a refused
 * connect or a timeout is indistinguishable from deadness from where we sit;
 * DNS is the only honest test we control.
 *
 * Callers apply their own policy over the same verdict:
 *   - a CONSERVATIVE caller ("proved serving") reads live === true
 *   - the issue reporter files on live !== false (never waste the slot on a
 *     confirmed-dead host, but never silently drop a live one either)
 */

const LIVENESS_TIMEOUT_MS = 8_000;
const DNS_TIMEOUT_MS = 4_000;

/** Why the probe reached its verdict — recorded on the drain/defer stamp so an
 *  outcome is diagnosable months later without a live re-probe. */
export type LivenessReason =
  | "http" // got an HTTP response over https
  | "tls" // TLS handshake failed; TCP connect proved the host up
  | "tls_http_fallback" // https TLS failed, http:// answered
  | "nxdomain" // NXDOMAIN on A and NS — genuinely gone
  | "timeout" // request aborted at the deadline
  | "refused" // connection refused / reset, but DNS resolves
  | "other"; // unclassified transport error, DNS resolves

export interface LivenessVerdict {
  /** true = proved serving · false = proved gone (NXDOMAIN only) · null = inconclusive. */
  live: boolean | null;
  reason: LivenessReason;
  /** HTTP status when one was received. */
  status?: number;
}

/** Node surfaces transport failures as `TypeError: fetch failed` with the real
 *  error on `.cause`. Walk the chain for a recognisable code/name. */
function errorCodeOf(err: unknown): string {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur; depth++) {
    const e = cur as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof e.code === "string" && e.code) return e.code;
    if (e.name === "AbortError" || e.name === "TimeoutError") return "ABORT_ERR";
    cur = e.cause;
  }
  return "";
}

/** Certificate / TLS-handshake failures. These require a COMPLETED TCP connect,
 *  so the host is up by definition — a broken cert is a hallmark of a hastily
 *  stood-up phishing host, not of a dead one. */
function isTlsError(code: string): boolean {
  return (
    code.startsWith("ERR_TLS_") ||
    code.startsWith("ERR_SSL_") ||
    code.includes("CERT_") ||
    code === "CERT_HAS_EXPIRED" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "EPROTO"
  );
}

/** Outcome of one DNS query: the records, or the resolver's error code. */
export type DnsLookup = { records: string[] } | { errorCode: string };

/**
 * Resolver error codes that actually prove the name does not exist (NXDOMAIN
 * class). Everything else — SERVFAIL, REFUSED, timeouts, connection errors —
 * means our resolver had a bad day, which is not a fact about the domain.
 *
 * ENODATA is NOT here (PR B, 2026-09-23): c-ares raises it for DNS NODATA —
 * the name EXISTS but has no record of the queried type. It used to be, so a
 * delegated zone with no A and a subdomain with no NS both read as "gone".
 */
const NAME_ABSENT_CODES = new Set(["ENOTFOUND", "NOTFOUND", "NXDOMAIN"]);
/** The name exists; it just has no record of this type. */
const NO_DATA_CODE = "ENODATA";

/** True when this lookup proves the name is absent (as opposed to unreachable). */
function provesAbsent(l: DnsLookup): boolean {
  return "errorCode" in l && NAME_ABSENT_CODES.has(l.errorCode);
}

/** True when this lookup proves the name exists without records of its type. */
function isNoData(l: DnsLookup): boolean {
  return "errorCode" in l && l.errorCode === NO_DATA_CODE;
}

/**
 * Is this lookup an ANSWER about the name — records, NXDOMAIN-class or NODATA
 * — rather than a resolver failure (SERVFAIL, REFUSED, timeout, UNKNOWN)?
 * The recheck gate's fingerprint is built only from answers (it used to carry
 * its own copy of these codes, `ANSWER_CODES`).
 */
export function isDnsAnswer(l: DnsLookup): boolean {
  return "records" in l || provesAbsent(l) || isNoData(l);
}

/** The lookup returned at least one record. */
function hasRecords(l: DnsLookup): boolean {
  return "records" in l && l.records.length > 0;
}

/** The lookup ANSWERED with no address: empty, NODATA or NXDOMAIN-class. */
function answeredNoAddress(l: DnsLookup): boolean {
  return ("records" in l && l.records.length === 0) || isNoData(l) || provesAbsent(l);
}

/** Stand-in for a lookup that was never made (AAAA skipped, probe failed). */
const NOT_QUERIED: DnsLookup = { errorCode: "UNKNOWN" };

/**
 * Decide deadness from an A lookup and an NS lookup. Pure, so the three-valued
 * logic is unit-testable without a live resolver. This is the LIFECYCLE
 * question ("is this domain gone?") — see {@link classifyHostLookups} for the
 * scanning question ("does it point at a host?").
 *
 *   false — A or NS records exist, or either lookup answered NODATA: the name
 *           is there.
 *   true  — BOTH lookups proved absence (NXDOMAIN class). The only honest "gone".
 *   null  — any lookup failed for a reason that is not absence. Prove nothing.
 *
 * `ns` is lazy so the caller can skip the second query when A already decided.
 *
 * History: both lookups used to be `.catch(() => [] as string[])`, flattening
 * SERVFAIL/REFUSED/timeouts into "gone" (PR 7); then ENODATA sat in the absent
 * set, so NODATA read as "gone" too (PR B). Only NXDOMAIN proves deadness.
 */
export function classifyDnsLookups(
  a: DnsLookup,
  ns: () => DnsLookup,
): boolean | null {
  if ("records" in a) {
    if (a.records.length > 0) return false;
    // Answered, but empty. Not proof of absence on its own — confirm via NS.
  } else if (isNoData(a)) {
    return false;
  } else if (!provesAbsent(a)) {
    return null;
  }

  const nsResult = ns();
  if ("records" in nsResult) return nsResult.records.length === 0;
  if (isNoData(nsResult)) return false;
  return provesAbsent(nsResult) ? true : null;
}

/**
 * Does the name point at a host — an A or AAAA record? Pure. This is the
 * SCANNING / RE-EMERGENCE question, deliberately stricter than "not gone": a
 * zone still delegated (NS present) with its A removed cannot be rendered by
 * urlscan ("400 DNS Error" — prod sucway.net, apple.co.mw, amazom.yoga) and is
 * not a taken-down clone coming back.
 *
 *   true  — an A or AAAA record exists.
 *   false — both lookups answered with no address (NODATA, NXDOMAIN or empty).
 *   null  — a lookup failed for a reason that proves nothing.
 *
 * `aaaa` is lazy: skipped when A already has records.
 */
export function classifyHostLookups(
  a: DnsLookup,
  aaaa: () => DnsLookup,
): boolean | null {
  if (hasRecords(a)) return true;
  const v6 = aaaa();
  if (hasRecords(v6)) return true;
  return answeredNoAddress(a) && answeredNoAddress(v6) ? false : null;
}

/** Resolver failure codes for a DNS SERVFAIL answer (c-ares / Node). */
const SERVFAIL_CODES = new Set(["ESERVFAIL", "SERVFAIL"]);

function isServfail(l: DnsLookup): boolean {
  return "errorCode" in l && SERVFAIL_CODES.has(l.errorCode);
}

/**
 * What the urlscan SUBMIT precheck should do with a name. SUBMIT-ONLY — the
 * lifecycle question stays {@link classifyDnsLookups} (NXDOMAIN only) and the
 * re-emergence question stays {@link classifyHostLookups}.
 *
 *   "host"     — an A or AAAA record exists: submit.
 *   "no_host"  — both answered with no address (NODATA/NXDOMAIN/empty): skip.
 *   "servfail" — no address anywhere, and at least one lookup SERVFAILed while
 *                the other SERVFAILed or answered no-address: skip.
 *   "unknown"  — anything else (a timeout, REFUSED, an unknown code): submit,
 *                exactly as before.
 *
 * Why SERVFAIL may skip here but never proves "gone": PR 7 turned SERVFAIL into
 * lifecycle deadness and produced false dead verdicts, so for the LIFECYCLE a
 * SERVFAIL still proves nothing. The submit precheck is a different trade:
 * every SERVFAIL domain measured in prod (18/18, 2026-09-24/25) was also
 * refused by urlscan with "DNS Error - Could not resolve domain", and urlscan's
 * refusal already stamps the row onto the same 168 h dead-domain cadence
 * (status 400). Skipping only saves the reputation + urlscan calls and stops
 * the refusal reading as a submit failure; a domain that recovers is retried
 * on the identical schedule. A TIMEOUT is not a SERVFAIL (lame delegations
 * sometimes time out, but so does a slow resolver) and stays "unknown".
 */
export type SubmitPrecheck = "host" | "no_host" | "servfail" | "unknown";

export function classifySubmitPrecheck(
  a: DnsLookup,
  aaaa: () => DnsLookup,
): SubmitPrecheck {
  const verdict = classifyHostLookups(a, aaaa);
  if (verdict === true) return "host";
  if (verdict === false) return "no_host";
  const v6 = aaaa();
  const servfailOrEmpty = (l: DnsLookup) => isServfail(l) || answeredNoAddress(l);
  return (isServfail(a) || isServfail(v6)) &&
    servfailOrEmpty(a) &&
    servfailOrEmpty(v6)
    ? "servfail"
    : "unknown";
}

/** Run one resolver query, capturing the error code instead of discarding it. */
async function lookup(fn: () => Promise<string[]>): Promise<DnsLookup> {
  try {
    return { records: await fn() };
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    return { errorCode: typeof code === "string" ? code : "UNKNOWN" };
  }
}

function resolver(): Resolver {
  return new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
}

// ════════════════════════════════════════════════════════════════════════════
// Domain DNS State — ONE probe, ONE state, every DNS verdict a reading of it.
// ════════════════════════════════════════════════════════════════════════════
//
// WHY (2026-09-28, architecture review of map #1224). Eight rules answered
// "is this lookalike alive?" from four different probes, and two of them
// disagreed on the one case that matters: a name whose NS still resolves but
// which has NO address. The weaponised sweep called it `present` (isDomainGone
// → false), so a dormant clone with its A record pulled came back to
// `weaponised` and counted in the reconcile lane's `stranded_live`; the
// re-emergence monitor, month-end stock (`no_host`) and the v326 dead-dormancy
// exit all required an address. Two exit-from-dormant bars.
//
// Now: `probeDomainDns` asks the resolver once (A and NS together, AAAA when A
// has no record); `readDomainDnsState` turns the answers into ONE state; every
// caller reads that state. "Present" means RESOLVES TO AN ADDRESS, everywhere.

/** The raw answers of one probe. `aaaa` is null when A had records (not asked). */
export interface DnsAnswers {
  a: DnsLookup;
  aaaa: DnsLookup | null;
  ns: DnsLookup;
}

/**
 * THE SEAM: hostname → answers, `null` when the resolver itself could not be
 * built or threw outside a query. Two adapters: `probeDomainDns` (the real
 * resolver) and the fakes the tests pass. Never throws in the real adapter; a
 * fake that throws is read as `null` by `sweepDomainDns`.
 */
export type DnsProbe = (hostname: string) => Promise<DnsAnswers | null>;

/**
 * The real resolver adapter. A and NS in parallel (the NS answer both confirms
 * absence and names the parking provider), then AAAA only when A has no
 * records. DNS only: no HTTP, no paid calls. ~ms, 4 s cap per query.
 */
export const probeDomainDns: DnsProbe = async (hostname) => {
  if (!hostname) return null;
  try {
    const r = resolver();
    const [a, ns] = await Promise.all([
      lookup(() => r.resolve4(hostname)),
      lookup(() => r.resolveNs(hostname)),
    ]);
    const aaaa = hasRecords(a) ? null : await lookup(() => r.resolve6(hostname));
    return { a, aaaa, ns };
  } catch {
    return null;
  }
};

/**
 * gone        — NXDOMAIN on A and NS (classifyDnsLookups: the only honest gone)
 * resolves    — an A or AAAA record exists
 * no_host     — the name answered, but points at no address (NS-only zones,
 *               a pulled A record, NODATA on both address types)
 * unverified  — the resolver proved nothing (SERVFAIL / timeout / refused),
 *               or the probe itself failed
 */
export type DnsPresence = "gone" | "resolves" | "no_host" | "unverified";

export interface DomainDnsState {
  /** The answers the state was read from; null = the probe failed. */
  dns: DnsAnswers | null;
  presence: DnsPresence;
  /** The LIFECYCLE three-valued answer (isDomainGone): true only on NXDOMAIN. */
  gone: boolean | null;
  /** The SCANNING three-valued answer (resolvesToHost): an A/AAAA record. */
  hasAddress: boolean | null;
  /** The FRESH NS is a parking / aftermarket provider. null = no NS records
   *  came back (lookup failed or empty), so DNS cannot say. */
  parkingNs: boolean | null;
  /** Registry/registrar hold on the STORED RDAP statuses (DNS cannot see a
   *  hold; the caller passes what it stored). false when none were passed. */
  hold: boolean;
  /** An A/AAAA record sits on a shared anycast front (SHARED_FRONT_RANGES),
   *  where DNS cannot see a content change. */
  opaque: boolean;
}

/** Read the one state from a probe's answers (+ stored RDAP statuses). Pure. */
export function readDomainDnsState(
  dns: DnsAnswers | null,
  stored: { statuses?: readonly string[] } = {},
): DomainDnsState {
  const hold = isRegistryHold(stored.statuses ?? []);
  if (!dns) {
    return {
      dns: null,
      presence: "unverified",
      gone: null,
      hasAddress: null,
      parkingNs: null,
      hold,
      opaque: false,
    };
  }
  const gone = classifyDnsLookups(dns.a, () => dns.ns);
  const hasAddress = classifyHostLookups(dns.a, () => dns.aaaa ?? NOT_QUERIED);
  const presence: DnsPresence =
    gone === true
      ? "gone"
      : hasAddress === true
        ? "resolves"
        : hasAddress === false
          ? "no_host"
          : "unverified";
  const nsRecords = hasRecords(dns.ns) && "records" in dns.ns ? dns.ns.records : null;
  return {
    dns,
    presence,
    gone,
    hasAddress,
    parkingNs: nsRecords ? isParkingNameserver(nsRecords) : null,
    hold,
    opaque: isOpaqueAnswers(dns),
  };
}

// ── Readings — each verdict is a few lines over the state ─────────────────

/**
 * What the weaponised liveness sweep stores in `liveness_last_verdict` (and
 * what record_weaponised_liveness applies, v341). It reads BOTH questions of
 * the state, because the stored verdict drives two different rules:
 *
 *   present      — resolves to an ADDRESS (hasAddress true). The only verdict
 *                  that brings a dormant clone back, and the only one
 *                  `stranded_live` counts — the same bar as the re-emergence
 *                  monitor, month-end stock and the v326 dead-dormancy exit.
 *   no_host      — the name EXISTS (gone false) but no address was proven:
 *                  NS-only zones, a pulled A record. Before v341 this was
 *                  `present`. Not gone, so the NXDOMAIN clock resets.
 *   gone         — NXDOMAIN on A and NS (gone true). Starts / confirms the
 *                  dormancy clock.
 *   inconclusive — gone null and no address proven: the resolver proved
 *                  nothing. Only stamps.
 *
 * The dormancy ENTRY clock is therefore exactly v329's (it keys on `gone`);
 * only the address bar changed. It differs from `presence` on one edge: A and
 * AAAA NXDOMAIN with an NS failure is presence `no_host` (month-end stock's
 * reading, unchanged) but verdict `inconclusive` (v329's, unchanged).
 */
export type LivenessRecordVerdict = "present" | "no_host" | "gone" | "inconclusive";

export function livenessVerdictOf(state: DomainDnsState): LivenessRecordVerdict {
  if (state.gone === true) return "gone";
  if (state.hasAddress === true) return "present";
  if (state.gone === false) return "no_host";
  return "inconclusive";
}

/** The urlscan submit precheck over the state — see {@link classifySubmitPrecheck}. */
export function submitPrecheckOf(state: DomainDnsState): SubmitPrecheck {
  if (!state.dns) return "unknown";
  const { a, aaaa } = state.dns;
  return classifySubmitPrecheck(a, () => aaaa ?? NOT_QUERIED);
}

/**
 * DNS-only deadness — the LIFECYCLE verdict: true = NXDOMAIN-class (the name
 * does not exist), false = the name exists, null = the resolver proved
 * nothing. Used by `probeLivenessVerdict`'s DNS fallback (`dead_at_probe`).
 */
export async function isDomainGone(hostname: string): Promise<boolean | null> {
  return readDomainDnsState(await probeDomainDns(hostname)).gone;
}

/**
 * Does `hostname` resolve to a host (A or AAAA)? true / false / null as
 * {@link classifyHostLookups}. The re-emergence monitor's "is it back?" test.
 */
export async function resolvesToHost(hostname: string): Promise<boolean | null> {
  return readDomainDnsState(await probeDomainDns(hostname)).hasAddress;
}

/** The urlscan submit precheck — see {@link classifySubmitPrecheck}. */
export async function submitPrecheck(hostname: string): Promise<SubmitPrecheck> {
  return submitPrecheckOf(readDomainDnsState(await probeDomainDns(hostname)));
}

// ── Parking and registry hold ─────────────────────────────────────────────

/** A nameserver list on a parking / aftermarket provider (clone-watch's
 *  reading of the ONE table, @askarthur/scam-engine/parking-providers). */
export function isParkingNameserver(ns: readonly string[]): boolean {
  return ns.some((n) => hostUnder(n, CLONE_WATCH_PARKING_NS));
}

/**
 * EPP clientHold / serverHold on stored RDAP statuses, in any spelling the
 * writers store ("client hold", "clientHold", "server_hold" …). The ONE TS
 * rule; record_weaponised_liveness takes it per read (`hold`, v341) and keeps
 * its regex only for a caller that sends none. Parity pinned by
 * weaponisedLivenessVerdictSql.test.ts.
 */
export function isRegistryHold(statuses: readonly string[]): boolean {
  return statuses
    .map((s) => s.toLowerCase().replace(/[^a-z]/g, ""))
    .some((s) => s === "clienthold" || s === "serverhold");
}

// ── Shared fronts ─────────────────────────────────────────────────────────

/**
 * SHARED FRONTS — address ranges where DNS says nothing about what is served.
 *
 * WHY. The recheck gate assumes a go-live moves DNS. Behind a shared anycast
 * front it does not: a parked page and a phishing kit on Cloudflare resolve to
 * the SAME Cloudflare /24s, so the fingerprint reads "unchanged" through the
 * exact flip we exist to catch. Measured in the #1261 review (2026-09-27): 58
 * of the 108 weaponised alerts with a known IP were on Cloudflare, and 429 of
 * the 1,192 pool rows. A probe whose A/AAAA set touches one of these ranges is
 * OPAQUE (`DomainDnsState.opaque`): the recheck gate gives it the 7-day urlscan
 * floor at ANY age and ranks it first in stale fill.
 *
 * ONE list — add a front here, nowhere else.
 *   - Cloudflare: every published IPv4 range (cloudflare.com/ips-v4) plus the
 *     two IPv6 blocks that front customer zones.
 *   - GoDaddy's AWS Global Accelerator pair (named in the #1261 review) — many
 *     GoDaddy-hosted and GoDaddy-parked names resolve to exactly these two.
 *   - Vercel's shared apex and anycast ranges.
 */
export const SHARED_FRONT_RANGES: readonly string[] = [
  // Cloudflare IPv4
  "104.16.0.0/13",
  "172.64.0.0/13",
  "188.114.96.0/20",
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "131.0.72.0/22",
  // Cloudflare IPv6
  "2606:4700::/32",
  "2a06:98c1::/32",
  // GoDaddy (AWS Global Accelerator pair)
  "3.33.130.190/32",
  "15.197.148.33/32",
  // Vercel
  "76.76.21.0/24",
  "216.198.79.0/24",
];

/**
 * IPv6 text → its hextets with `::` expanded to zeros, lower-cased, zone id
 * dropped. NOT validated: each caller checks what it needs (the recheck
 * fingerprint only the first three groups, the front match all eight). The
 * ONE IPv6 parser (it was written twice).
 */
export function ipv6Groups(ip: string): string[] | null {
  const s = ip.toLowerCase().split("%")[0]!;
  if (!s.includes(":")) return null;
  const [head, tail] = s.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined && tail !== "" ? tail.split(":") : [];
  return tail === undefined
    ? h
    : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
}

function v4ToBigInt(ip: string): bigint | null {
  const o = ip.split(".");
  if (o.length !== 4) return null;
  let n = BigInt(0);
  for (const part of o) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = (n << BigInt(8)) | BigInt(Number(part));
  }
  return n;
}

function v6ToBigInt(ip: string): bigint | null {
  const groups = ipv6Groups(ip);
  if (!groups || groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g)))
    return null;
  return groups.reduce(
    (n, g) => (n << BigInt(16)) | BigInt(parseInt(g, 16)),
    BigInt(0),
  );
}

type ParsedRange = { v6: boolean; base: bigint; bits: number };

const PARSED_FRONTS: readonly ParsedRange[] = SHARED_FRONT_RANGES.map(
  (cidr) => {
    const [addr, len] = cidr.split("/") as [string, string];
    const v6 = addr.includes(":");
    const base = v6 ? v6ToBigInt(addr) : v4ToBigInt(addr);
    if (base === null)
      throw new Error(`SHARED_FRONT_RANGES: bad address ${cidr}`);
    return { v6, base, bits: Number(len) };
  },
);

/** Is this one address inside a shared front? Unparseable → false. */
export function isSharedFrontAddress(ip: string): boolean {
  const v6 = ip.includes(":");
  const n = v6 ? v6ToBigInt(ip) : v4ToBigInt(ip.trim());
  if (n === null) return false;
  const width = v6 ? 128 : 32;
  return PARSED_FRONTS.some((r) => {
    if (r.v6 !== v6) return false;
    const shift = BigInt(width - r.bits);
    return n >> shift === r.base >> shift;
  });
}

/**
 * Opaque = ANY A or AAAA record sits on a shared front. "Any", not "all": a
 * mixed set still routes some visitors through the front, where DNS cannot
 * see a content change — the conservative reading costs only earlier rescans.
 */
export function isOpaqueAnswers(dns: DnsAnswers | null): boolean {
  if (!dns) return false;
  const addrs = [dns.a, dns.aaaa].flatMap((l) =>
    l && "records" in l ? l.records : [],
  );
  return addrs.some(isSharedFrontAddress);
}

// ── The one bounded-concurrency sweep ─────────────────────────────────────

/** DNS probes in flight for a sweep. Each costs ~ms; a slow one caps at 4 s
 *  per query. The weaponised sweep and month-end stock both ran 16. */
export const DNS_SWEEP_CONCURRENCY = 16;

/**
 * Probe each target's hostname under a budget, `concurrency` in flight — the
 * ONE sweep behind the weaponised liveness sweep, the recheck DNS gate and the
 * month-end stock walk (three hand-rolled copies before 2026-09-28).
 *
 * Returns states INDEX-ALIGNED with `targets`: `states[i]` is null when the
 * budget expired before target i was picked (it stays due). Targets are picked
 * in order and none is picked after expiry, so the non-null entries are a
 * prefix of the picked set — month-end relies on that to carry its tail. A
 * probe that throws reads as `unverified`, never as gone or unchanged.
 *
 * Accumulators live inside the call: run it inside ONE step.run so a replay
 * re-runs it whole and never resumes a half-counted tally.
 */
export async function sweepDomainDns<T>(
  targets: readonly T[],
  hostnameOf: (t: T) => string,
  opts: {
    expired: () => boolean;
    /** The resolver seam. Required, never defaulted in here: a caller's own
     *  `probe = probeDomainDns` default goes through the module import, which
     *  is what a test's vi.mock of liveness.ts replaces. */
    probe: DnsProbe;
    concurrency?: number;
  },
): Promise<{ states: Array<DomainDnsState | null>; unreached: number }> {
  const { probe } = opts;
  const states: Array<DomainDnsState | null> = new Array(targets.length).fill(null);
  let unreached = 0;
  await mapWithConcurrency(
    targets.map((t, i) => ({ t, i })),
    opts.concurrency ?? DNS_SWEEP_CONCURRENCY,
    async ({ t, i }) => {
      if (opts.expired()) {
        unreached++;
        return;
      }
      let dns: DnsAnswers | null;
      try {
        dns = await probe(hostnameOf(t));
      } catch {
        dns = null;
      }
      states[i] = readDomainDnsState(dns);
    },
  );
  return { states, unreached };
}

/** One bounded GET. Returns the status, or throws for the caller to classify
 *  (the error carries the transport `code` errorCodeOf reads). Goes through
 *  safeFetch: guard + SSRF-safe dispatcher on every connect + per-hop
 *  redirect checks; the body is never read. A refusal surfaces as
 *  EPRIVATEHOST, which is neither TLS nor refused, so it falls through to the
 *  DNS check below like any other failed fetch. */
async function getStatus(url: string): Promise<number> {
  const r = await safeFetch(url, {
    method: "GET",
    redirect: "follow-checked",
    // fetch()'s own default; kits chain redirects through trackers.
    maxRedirects: 20,
    as: "none",
    timeoutMs: LIVENESS_TIMEOUT_MS,
    okStatus: () => true,
    headers: {
      "user-agent": "AskArthur-CloneWatch/1.0 (+https://askarthur.au)",
    },
  });
  if (r.ok) return r.status;
  throw Object.assign(new Error(r.detail), {
    code: r.code ?? (r.reason === "timeout" ? "ABORT_ERR" : undefined),
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname;
  } catch {
    return "";
  }
}

/** Swap the scheme to http:// for the TLS-failure fallback. */
function toHttp(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    u.protocol = "http:";
    return u.toString();
  } catch {
    return "";
  }
}

/** Injectable DNS check — lets tests exercise the classification without a
 *  live resolver, and keeps the network at the edge of the module. */
export interface LivenessDeps {
  resolveGone?: (hostname: string) => Promise<boolean | null>;
}

/**
 * Probe one URL and explain the answer. Never throws.
 *
 * An HTTP response < 500 is `live` (401/403/404 still means the host is up).
 * A 5xx is `null`: reachable but not serving, and these flap. A TLS failure
 * retries over http:// — the fallback frequently answers, and even when it
 * doesn't, the completed TCP connect rules out deadness. Anything else falls
 * through to DNS, which is the only check that can return `false`.
 */
export async function probeLivenessVerdict(
  url: string,
  deps: LivenessDeps = {},
): Promise<LivenessVerdict> {
  try {
    const status = await getStatus(url);
    return { live: status < 500 ? true : null, reason: "http", status };
  } catch (err) {
    const code = errorCodeOf(err);

    if (isTlsError(code)) {
      const httpUrl = toHttp(url);
      if (httpUrl) {
        try {
          const status = await getStatus(httpUrl);
          return status < 500
            ? { live: true, reason: "tls_http_fallback", status }
            : { live: null, reason: "tls", status };
        } catch {
          // http also failed — the TLS handshake still proved a live socket.
        }
      }
      return { live: null, reason: "tls" };
    }

    // A refused or reset connection is proof the name RESOLVED — the TCP stack
    // cannot get an RST from a host it never looked up. No DNS call needed, and
    // it is emphatically not death: phishing kits routinely drop datacentre
    // egress ranges, which looks identical from Vercel.
    if (code === "ECONNREFUSED" || code === "ECONNRESET") {
      return { live: null, reason: "refused" };
    }

    // Everything else (timeout, ENOTFOUND, unknown) could be a dead name.
    // DNS is the only check that may return `false`.
    const resolveGone = deps.resolveGone ?? isDomainGone;
    const gone = await resolveGone(hostnameOf(url));
    if (gone === true) return { live: false, reason: "nxdomain" };

    if (code === "ABORT_ERR" || code === "UND_ERR_CONNECT_TIMEOUT") {
      return { live: null, reason: "timeout" };
    }
    return { live: null, reason: "other" };
  }
}

/** HTTP liveness probes in flight (the netcraft-auto resubmit and
 *  netcraft-issue lanes). HTTP, not DNS — distinct from DNS_SWEEP_CONCURRENCY. */
export const HTTP_PROBE_CONCURRENCY = 4;

/**
 * Probe a batch of URLs with bounded concurrency; duplicates are probed once.
 * Returns url → verdict. Never throws.
 *
 * The boolean-map variant this replaced (`probeLiveness`) lost its last caller
 * when the issue reporter moved to verdicts, and a batch helper that discards
 * the reason is the exact shape that made the July false-dead incident
 * undiagnosable. Callers wanting the conservative view read `.live === true`
 * off the verdict.
 */
export async function probeLivenessDetailed(
  urls: string[],
  concurrency = HTTP_PROBE_CONCURRENCY,
): Promise<Map<string, LivenessVerdict>> {
  const out = new Map<string, LivenessVerdict>();
  await mapWithConcurrency([...new Set(urls)], concurrency, async (url) => {
    out.set(url, await probeLivenessVerdict(url));
  });
  return out;
}
