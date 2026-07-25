import { Resolver } from "node:dns/promises";

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
 * (proved serving) or `null` (inconclusive). This mirrors `domainResolves()` in
 * clone-watch-reemergence-monitor.ts, which already returns `boolean | null`
 * for the same reason — "skip this round rather than risk a false reopen".
 * Vercel egress IPs are routinely blocked by phishing kits, so a refused
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
  | "nxdomain" // no A and no NS record — genuinely gone
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

/** True when the domain has neither an A nor an NS record — the only signal
 *  that honestly means "gone". Inconclusive resolver errors read as `null`,
 *  matching clone-watch-reemergence-monitor.ts's domainResolves(). */
async function domainIsGone(hostname: string): Promise<boolean | null> {
  if (!hostname) return null;
  const r = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
  try {
    const a = await r.resolve4(hostname).catch(() => [] as string[]);
    if (a.length > 0) return false;
    const ns = await r.resolveNs(hostname).catch(() => [] as string[]);
    return ns.length === 0;
  } catch {
    return null; // resolver itself failed — prove nothing
  }
}

/** One bounded GET. Returns the status, or throws for the caller to classify. */
async function getStatus(url: string): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIVENESS_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": "AskArthur-CloneWatch/1.0 (+https://askarthur.au)",
      },
    });
    return res.status;
  } finally {
    clearTimeout(timer);
  }
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
    const resolveGone = deps.resolveGone ?? domainIsGone;
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
