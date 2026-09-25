// The ONE way to fetch a URL we don't control.
//
// Before this Module every caller that fetched an attacker-influenced URL
// (shop pages, review APIs, images, liveness probes, site audits, persona
// pages, extension/skill downloads) assembled the same five controls by hand:
// the syntactic guard, the SSRF-safe dispatcher, per-hop redirect checks, a
// streaming body cap, and a timeout. ~18 call sites, two host blocklists that
// had drifted, and one caller that followed redirects with no per-hop check.
// `safeFetch` owns all five; callers choose only the policy (cap, timeout,
// redirect mode, body form).
//
//   - Guard: `checkOutboundUrl` (ssrf-guard) on the initial URL and on EVERY
//     redirect target, before it is fetched.
//   - Resolution-time guard: `ssrfSafeDispatcher` — a NAME that resolves to a
//     private IP (including a mixed answer, or DNS rebinding between check and
//     connect) and a private IP LITERAL are both refused at connect.
//   - Redirects: followed manually so each Location is checked first
//     ("follow-checked"), returned to the caller ("manual"), or refused ("error").
//   - Body: streamed with a hard byte cap (`readBodyCapped`) — reject or truncate.
//   - Timeout: one wall-clock budget across the whole chain AND the body read.
//
//   - Redirect hygiene: a hop to another origin (other than an http→https
//     upgrade of the same host) drops the body and credentials; credentials
//     cannot be combined with automatic redirects at all.
//
// Never throws for network/HTTP/size/timeout/guard outcomes — every one is a
// typed failure. It only throws on programmer error (a body form without a
// cap, or Authorization/Cookie/Proxy-Authorization with "follow-checked").

import { readBodyCapped } from "@askarthur/utils/read-body-capped";
import { checkOutboundUrl } from "./ssrf-guard";
import { ssrfSafeDispatcher } from "./ssrf-dispatcher";

export type SafeFetchRedirect = "follow-checked" | "manual" | "error";
export type SafeFetchBodyForm = "text" | "bytes" | "json" | "none";

export type SafeFetchFailureReason =
  /** The URL or a redirect target is private/blocked (syntactic or at connect). */
  | "blocked"
  | "timeout"
  /** Body over `maxBytes` (reject mode only). */
  | "too_large"
  /** Final status not accepted by `okStatus`. */
  | "http"
  /** Redirect limit, loop, missing/invalid Location, or a redirect in "error" mode. */
  | "redirects"
  /** `as: "json"` and the body did not parse. */
  | "invalid_json"
  /** `beforeBody` refused the response from its status/headers. */
  | "rejected"
  | "network";

export interface SafeFetchOptions {
  method?: "GET" | "HEAD" | "POST";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** Wall-clock budget for the whole call: every hop plus the body read. */
  timeoutMs: number;
  /** Required unless `as: "none"`. */
  maxBytes?: number;
  /** Keep the first `maxBytes` instead of failing with `too_large`. */
  truncate?: boolean;
  /** Default "follow-checked". */
  redirect?: SafeFetchRedirect;
  /** Redirects followed before giving up ("follow-checked" only). Default 5;
   *  callers replacing a plain `redirect: "follow"` fetch pass
   *  `FETCH_DEFAULT_MAX_REDIRECTS` to keep fetch's limit. */
  maxRedirects?: number;
  /** Default "text". */
  as?: SafeFetchBodyForm;
  /** Which final statuses count as success. Default 2xx (plus 3xx in "manual"). */
  okStatus?: (status: number) => boolean;
  /** When set, only these exact hostnames may be requested — checked on the
   *  initial URL and every redirect hop (in addition to the private-host guard). */
  allowHosts?: ReadonlySet<string>;
  /** Per-hop redirect policy ("follow-checked" only), on top of the guard:
   *  return false to refuse a hop (reason "redirects", detail
   *  "redirect-refused"). E.g. `sameOriginOrUpgrade` for a signed POST. */
  allowRedirect?: (from: URL, to: URL) => boolean;
  /** Extra header names (case-insensitive) stripped on a hop to another
   *  origin, e.g. a request signature. Always added to the credential set
   *  (authorization, cookie, proxy-authorization); never replaces it. */
  sensitiveHeaders?: string[];
  /** Inspect the final response's status/headers BEFORE any body byte is
   *  read (e.g. a content-type allowlist). Return a short detail string to
   *  refuse it (reason "rejected"), or undefined to accept. */
  beforeBody?: (status: number, headers: Headers) => string | undefined;
  /** Caller cancellation, combined with the internal timeout. */
  signal?: AbortSignal;
  /** Test seams. */
  fetchImpl?: typeof fetch;
  dispatcher?: unknown;
}

interface SafeFetchMeta {
  /** Last HTTP status seen, or null when no response arrived. */
  status: number | null;
  /** The URL of the last request made (or refused). */
  finalUrl: string;
  /** Every URL requested, in order (initial URL first). */
  hops: string[];
  /** Headers of the last response, or null when none arrived. */
  headers: Headers | null;
}

export type SafeFetchResult<T> =
  | ({ ok: true; body: T; truncated: boolean } & SafeFetchMeta & {
      status: number;
      headers: Headers;
    })
  | ({
      ok: false;
      reason: SafeFetchFailureReason;
      /** Short machine-readable sub-kind, e.g. "private-redirect", "http-404". */
      detail: string;
      /** The transport error code (e.g. ECONNREFUSED, ERR_TLS_CERT_ALTNAME_INVALID,
       *  ENOTFOUND, EPRIVATEHOST) for callers that classify network failures. */
      code?: string;
    } & SafeFetchMeta);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_MAX_REDIRECTS = 5;
/** The WHATWG fetch redirect limit — for callers that used `redirect: "follow"`. */
export const FETCH_DEFAULT_MAX_REDIRECTS = 20;
/** Credentials that must never ride a redirect to another origin. */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/** `to` is `from`'s origin, or the same host upgraded from http (default
 *  port) to https (default port). Such a hop keeps the method, body and
 *  headers; any other origin change drops them. */
export function sameOriginOrUpgrade(from: URL, to: URL): boolean {
  if (to.origin === from.origin) return true;
  return (
    to.hostname === from.hostname &&
    from.protocol === "http:" &&
    to.protocol === "https:" &&
    (from.port === "" || from.port === "80") &&
    (to.port === "" || to.port === "443")
  );
}

export function safeFetch(
  url: string,
  opts: SafeFetchOptions & { as: "bytes" },
): Promise<SafeFetchResult<Uint8Array>>;
export function safeFetch(
  url: string,
  opts: SafeFetchOptions & { as: "json" },
): Promise<SafeFetchResult<unknown>>;
export function safeFetch(
  url: string,
  opts: SafeFetchOptions & { as: "none" },
): Promise<SafeFetchResult<null>>;
export function safeFetch(
  url: string,
  opts: SafeFetchOptions & { as?: "text" },
): Promise<SafeFetchResult<string>>;
export async function safeFetch(
  url: string,
  opts: SafeFetchOptions,
): Promise<SafeFetchResult<unknown>> {
  const as = opts.as ?? "text";
  const redirect = opts.redirect ?? "follow-checked";
  const maxRedirects = opts.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (as !== "none" && !(typeof opts.maxBytes === "number" && opts.maxBytes > 0)) {
    throw new Error("safeFetch: maxBytes is required unless as is \"none\"");
  }
  const sensitive = Object.keys(opts.headers ?? {}).filter((h) =>
    CREDENTIAL_HEADERS.includes(h.toLowerCase()),
  );
  if (redirect === "follow-checked" && sensitive.length > 0) {
    // A credential plus automatic redirects is how a token reaches a host the
    // caller never chose. Use redirect "error" or "manual" instead.
    throw new Error(
      `safeFetch: ${sensitive.join(", ")} cannot be combined with redirect "follow-checked"`,
    );
  }
  const okStatus =
    opts.okStatus ??
    ((s: number) =>
      (s >= 200 && s < 300) || (redirect === "manual" && s >= 300 && s < 400));
  const doFetch = opts.fetchImpl ?? fetch;
  const dispatcher = opts.dispatcher ?? ssrfSafeDispatcher;

  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;

  const hops: string[] = [];
  const seen = new Set<string>();
  let current = url;
  let method = opts.method ?? "GET";
  let body = opts.body;
  let headers: Record<string, string> | undefined = opts.headers;
  const stripOnCrossOrigin = new Set([
    ...CREDENTIAL_HEADERS,
    ...(opts.sensitiveHeaders ?? []).map((h) => h.toLowerCase()),
  ]);
  let lastStatus: number | null = null;
  let lastHeaders: Headers | null = null;

  const fail = (
    reason: SafeFetchFailureReason,
    detail: string,
    code?: string,
  ): SafeFetchResult<never> => ({
    ok: false,
    reason,
    detail,
    ...(code ? { code } : {}),
    status: lastStatus,
    finalUrl: current,
    hops,
    headers: lastHeaders,
  });

  // A spent budget fails before any request (AbortSignal.timeout(0) only
  // fires on a later tick). Callers sharing one budget across fetches rely on it.
  if (!(opts.timeoutMs > 0)) return fail("timeout", "timeout", "ABORT_ERR");

  try {
    for (let redirects = 0; ; redirects++) {
      if (signal.aborted) throw signal.reason;
      const check = checkOutboundUrl(current);
      if (!check.ok) {
        return fail("blocked", hops.length === 0 ? "private-url" : "private-redirect");
      }
      if (opts.allowHosts && !opts.allowHosts.has(check.url.hostname.toLowerCase())) {
        return fail("blocked", "host-not-allowed");
      }
      if (seen.has(current)) return fail("redirects", "loop");
      seen.add(current);
      hops.push(current);

      const res = await doFetch(current, {
        method,
        headers,
        body: body as BodyInit | undefined,
        redirect: "manual",
        signal,
        // `dispatcher` is undici-specific (Node's fetch is undici); not in
        // lib.dom RequestInit. The cast is intentional.
        ...({ dispatcher } as Record<string, unknown>),
      });
      lastStatus = res.status;
      lastHeaders = res.headers;

      const location = res.headers.get("location");
      // A 3xx without Location is a final response (fetch returns it too);
      // okStatus decides whether it counts.
      if (REDIRECT_STATUSES.has(res.status) && redirect !== "manual" && location) {
        await res.body?.cancel().catch(() => undefined);
        if (redirect === "error") return fail("redirects", "redirect-refused");
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return fail("redirects", "invalid-location");
        }
        if (opts.allowRedirect && !opts.allowRedirect(new URL(current), new URL(next))) {
          return fail("redirects", "redirect-refused");
        }
        if (redirects >= maxRedirects) {
          current = next;
          return fail("redirects", "limit");
        }
        // Browser semantics: 303 always, and 301/302 for a non-GET/HEAD,
        // become a bodiless GET. 307/308 keep the method and body.
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) &&
            method !== "GET" &&
            method !== "HEAD")
        ) {
          method = method === "HEAD" ? "HEAD" : "GET";
          body = undefined;
        }
        // Another origin never receives the caller's credentials or body.
        if (!sameOriginOrUpgrade(new URL(current), new URL(next))) {
          body = undefined;
          if (method !== "GET" && method !== "HEAD") method = "GET";
          if (headers) {
            headers = Object.fromEntries(
              Object.entries(headers).filter(
                ([h]) => !stripOnCrossOrigin.has(h.toLowerCase()),
              ),
            );
          }
        }
        current = next;
        continue;
      }

      if (!okStatus(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        return fail("http", `http-${res.status}`);
      }
      let refusal: string | undefined;
      try {
        refusal = opts.beforeBody?.(res.status, res.headers);
      } catch {
        refusal = "before-body-threw";
      }
      if (refusal) {
        await res.body?.cancel().catch(() => undefined);
        return fail("rejected", refusal);
      }

      const meta = {
        status: res.status,
        finalUrl: current,
        hops,
        headers: res.headers,
      };
      if (as === "none" || method === "HEAD") {
        await res.body?.cancel().catch(() => undefined);
        return { ok: true, body: null, truncated: false, ...meta };
      }

      const read = await readBodyCapped(res, opts.maxBytes!, {
        truncate: opts.truncate,
      });
      if (!read.ok && read.reason === "too_large") return fail("too_large", "body-too-large");
      // 204 / a null body is an empty body, not a failure (fetch's text() is "").
      const bytes = read.ok ? read.bytes : new Uint8Array(0);
      const truncated = read.ok && read.truncated;
      if (as === "bytes") return { ok: true, body: bytes, truncated, ...meta };
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      if (as === "text") return { ok: true, body: text, truncated, ...meta };
      try {
        return { ok: true, body: JSON.parse(text), truncated, ...meta };
      } catch {
        return fail("invalid_json", text === "" ? "empty-body" : "invalid-json");
      }
    }
  } catch (err) {
    if (timeout.aborted) return fail("timeout", "timeout", "ABORT_ERR");
    if (isPrivateHostError(err)) return fail("blocked", "private-host", "EPRIVATEHOST");
    if (opts.signal?.aborted) return fail("network", "aborted", "ABORT_ERR");
    // Only our timeout or the caller's signal (checked above) can abort a
    // request, so a remaining AbortError/TimeoutError is the deadline.
    if (isTimeoutError(err)) return fail("timeout", "timeout", "ABORT_ERR");
    return fail("network", errorMessage(err), errorCode(err));
  }
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      (err.cause instanceof Error &&
        (err.cause.name === "TimeoutError" || err.cause.name === "AbortError")))
  );
}

/** The dispatcher's refusal surfaces as undici's `TypeError('fetch failed')`
 *  with the connector error as `cause`. */
function isPrivateHostError(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; depth < 4 && e; depth++) {
    if ((e as NodeJS.ErrnoException).code === "EPRIVATEHOST") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** First string `code` on the error or its cause chain (undici wraps the
 *  transport error as `TypeError('fetch failed')` with the real one as cause). */
function errorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let depth = 0; depth < 5 && e; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  const cause = (err as { cause?: unknown })?.cause;
  const msg = err instanceof Error ? err.message : String(err);
  const causeMsg = cause instanceof Error ? cause.message : "";
  return (causeMsg ? `${msg}: ${causeMsg}` : msg).slice(0, 200);
}
