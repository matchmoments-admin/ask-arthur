import { Resolver } from "node:dns/promises";
import { safeFetch } from "@askarthur/scam-engine/safe-fetch";

/**
 * Clone-watch liveness probing — shared by auto-triage (confirm a clone is
 * still serving before auto-confirming) and the Netcraft issue reporter
 * (never spend a one-per-submission issue slot on a dead site).
 *
 * Moved verbatim from clone-watch-auto-triage.ts (F3); auto-triage re-exports
 * so its callers and tests are unchanged.
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
 * risk a false verdict". Two DNS verdicts live here, one per question:
 * `isDomainGone` (lifecycle: NXDOMAIN only) and `resolvesToHost` (scanning and
 * re-emergence: an A/AAAA record). Vercel egress IPs are routinely blocked by phishing kits, so a refused
 * connect or a timeout is indistinguishable from deadness from where we sit;
 * DNS is the only honest test we control.
 *
 * Callers apply their own policy over the same verdict:
 *   - auto-triage keeps the CONSERVATIVE bar via isCandidateLive() (live === true)
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
  const hasAddress = (l: DnsLookup) => "records" in l && l.records.length > 0;
  const answeredNoAddress = (l: DnsLookup) =>
    ("records" in l && l.records.length === 0) || isNoData(l) || provesAbsent(l);
  if (hasAddress(a)) return true;
  const v6 = aaaa();
  if (hasAddress(v6)) return true;
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
  const noAddress = (l: DnsLookup) =>
    ("records" in l && l.records.length === 0) || isNoData(l) || provesAbsent(l);
  const servfailOrEmpty = (l: DnsLookup) => isServfail(l) || noAddress(l);
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

/**
 * DNS-only deadness — the LIFECYCLE verdict: true = NXDOMAIN-class (the name
 * does not exist), false = the name exists, null = the resolver proved
 * nothing. Cheap (~ms, 4 s cap). The NS query runs only when A proved absence
 * or answered empty.
 */
export async function isDomainGone(hostname: string): Promise<boolean | null> {
  if (!hostname) return null;
  const r = resolver();
  try {
    const a = await lookup(() => r.resolve4(hostname));
    const needNs = ("records" in a && a.records.length === 0) || provesAbsent(a);
    const ns = needNs ? await lookup(() => r.resolveNs(hostname)) : null;
    return classifyDnsLookups(a, () => ns ?? { errorCode: "UNKNOWN" });
  } catch {
    return null; // resolver itself failed — prove nothing
  }
}

/**
 * Does `hostname` resolve to a host (A or AAAA)? true / false / null as
 * {@link classifyHostLookups}. The precheck urlscan submits use before spending
 * a scan, and the re-emergence monitor's "is it back?" test. Cheap (~ms, 4 s
 * cap). The AAAA query runs only when A has no records.
 */
export async function resolvesToHost(hostname: string): Promise<boolean | null> {
  if (!hostname) return null;
  const r = resolver();
  try {
    const a = await lookup(() => r.resolve4(hostname));
    const needAaaa = !("records" in a && a.records.length > 0);
    const aaaa = needAaaa ? await lookup(() => r.resolve6(hostname)) : null;
    return classifyHostLookups(a, () => aaaa ?? { errorCode: "UNKNOWN" });
  } catch {
    return null;
  }
}

/**
 * The urlscan submit precheck — see {@link classifySubmitPrecheck}. Both A and
 * AAAA are always queried unless A already has records (the servfail verdict
 * needs both answers). Cheap (~ms, 4 s cap per query).
 */
export async function submitPrecheck(hostname: string): Promise<SubmitPrecheck> {
  if (!hostname) return "unknown";
  const r = resolver();
  try {
    const a = await lookup(() => r.resolve4(hostname));
    const needAaaa = !("records" in a && a.records.length > 0);
    const aaaa = needAaaa ? await lookup(() => r.resolve6(hostname)) : null;
    return classifySubmitPrecheck(a, () => aaaa ?? { errorCode: "UNKNOWN" });
  } catch {
    return "unknown";
  }
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

/**
 * Conservative boolean view — "is this host PROVED to be serving?".
 * Inconclusive reads as false, so auto-triage's strict auto-confirm bar is
 * unchanged by the three-valued rewrite. Do NOT use this where the question is
 * "is this host dead?" — use probeLivenessVerdict and test `live === false`.
 */
export async function isCandidateLive(
  url: string,
  deps: LivenessDeps = {},
): Promise<boolean> {
  return (await probeLivenessVerdict(url, deps)).live === true;
}

/** Bounded-concurrency map over unique URLs. Never throws. */
async function probeMap<T>(
  urls: string[],
  concurrency: number,
  probe: (url: string) => Promise<T>,
): Promise<Map<string, T>> {
  const unique = [...new Set(urls)];
  const out = new Map<string, T>();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, unique.length) },
    async () => {
      while (cursor < unique.length) {
        const url = unique[cursor++];
        out.set(url, await probe(url));
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * Probe a batch of URLs with bounded concurrency; duplicates are probed once.
 * Returns url → verdict. Never throws.
 *
 * The boolean-map variant this replaced (`probeLiveness`) lost its last caller
 * when the issue reporter moved to verdicts, and a batch helper that discards
 * the reason is the exact shape that made the July false-dead incident
 * undiagnosable. Callers wanting the conservative view compose
 * `isCandidateLive` themselves, or read `.live === true` off the verdict.
 */
export async function probeLivenessDetailed(
  urls: string[],
  concurrency = 4,
): Promise<Map<string, LivenessVerdict>> {
  return probeMap(urls, concurrency, probeLivenessVerdict);
}
