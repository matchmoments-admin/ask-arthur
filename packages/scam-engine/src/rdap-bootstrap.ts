// IANA RDAP bootstrap (RFC 9224) — maps a TLD to its authoritative registry
// RDAP base URL, so we can query the registry DIRECTLY instead of via the
// rdap.org redirector.
//
// WHY (measured on prod 2026-07-18): rdap.org is a shared convenience redirector
// that rate-limits under burst. The enricher fires 17-34 sequential RDAP lookups
// per run; rdap.org's latency then collapses (first request ~1.3s, most of the
// rest hit the 8s abort) and ~75% of RDAP-capable lookups time out and silently
// fall back to whoisjson — discarding the EPP statuses / IANA id / abuse contact
// that are the whole point. Hitting the registry servers directly under the same
// burst held at ~0.4s each: they're separate infra per TLD, so load spreads.
//
// This module owns fetching + caching + parsing the bootstrap and resolving a
// TLD to a base URL. `fetchRdapDomain` (rdap.ts) uses it for the fast path and
// keeps rdap.org as a fallback, so the change is strictly additive.
//
// Cost: the bootstrap is a free ~71KB static file from data.iana.org, fetched at
// most once per ~12h (Redis TTL) / once per warm process (memo). No per-lookup
// cost. This REDUCES whoisjson usage (its near-exhausted 1000/mo cap) and
// shortens enricher runtime.

import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";
import { ssrfSafeDispatcher } from "./ssrf-dispatcher";

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_CACHE_KEY = "askarthur:rdap-bootstrap";
const BOOTSTRAP_TTL = 43_200; // 12h Redis TTL (matches ct-lookup)
const MEMO_TTL_MS = 60 * 60 * 1000; // 1h in-process memo freshness
const BOOTSTRAP_FETCH_TIMEOUT_MS = 5000;

/** Raw shape of https://data.iana.org/rdap/dns.json (RFC 9224). */
interface IanaBootstrap {
  version?: string;
  publication?: string;
  services?: Array<[string[], string[]]>;
}

let _redis: Redis | null = null;
function getRedis(): Redis | null {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

/**
 * Pure: parse raw bootstrap JSON into a lowercased TLD→baseURL map. Keys are
 * single-label eTLDs (`au`, not `com.au`; IDN TLDs as A-labels e.g. `xn--p1ai`).
 * Prefers an `https:` base, skips entries with no URLs, normalises the base to
 * exactly one trailing slash. Returns null if the shape isn't a `services` array.
 * Exported for tests.
 */
export function parseBootstrap(json: unknown): Map<string, string> | null {
  if (!json || typeof json !== "object") return null;
  const services = (json as IanaBootstrap).services;
  if (!Array.isArray(services)) return null;

  const map = new Map<string, string>();
  for (const entry of services) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [tlds, urls] = entry;
    if (!Array.isArray(tlds) || !Array.isArray(urls) || urls.length === 0) {
      continue;
    }
    // Prefer the first https base; fall back to the last listed URL.
    const httpsBase = urls.find(
      (u) => typeof u === "string" && u.startsWith("https:"),
    );
    const rawBase = httpsBase ?? urls[urls.length - 1];
    if (typeof rawBase !== "string" || !rawBase) continue;
    const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
    for (const tld of tlds) {
      if (typeof tld === "string" && tld) map.set(tld.toLowerCase(), base);
    }
  }
  return map.size > 0 ? map : null;
}

/**
 * Pure: registry base URL for a domain's TLD, or null when the TLD has no RDAP
 * server (e.g. `.ru`) or the input has no TLD label. Exported for tests.
 */
export function resolveRegistryBase(
  domain: string,
  bootstrap: Map<string, string>,
): string | null {
  const parts = domain.toLowerCase().split(".");
  if (parts.length < 2) return null; // no TLD label
  const tld = parts[parts.length - 1];
  return bootstrap.get(tld) ?? null;
}

/**
 * Pure: build the RDAP domain-query URL. RFC 9083 path is `{base}domain/{name}`;
 * tolerate a base with or without a trailing slash. Exported for tests.
 */
export function buildRegistryDomainUrl(base: string, domain: string): string {
  const b = base.endsWith("/") ? base : `${base}/`;
  return `${b}domain/${encodeURIComponent(domain)}`;
}

// Two-tier cache state. The process memo amortises the bootstrap across the
// 17-34 lookups of one run; the in-flight promise collapses the cold-start race
// (the enricher's per-alert Promise.all fires two RDAP lookups concurrently, so
// two getRdapBootstrap() calls race on the very first alert of a cold process).
let _memo: { map: Map<string, string>; fetchedAt: number } | null = null;
let _inflight: Promise<Map<string, string> | null> | null = null;

async function loadBootstrap(): Promise<Map<string, string> | null> {
  const redis = getRedis();

  // Redis blob — store/read the RAW JSON object, never the Map (Upstash
  // JSON-serialises a Map to `{}`); reconstruct via parseBootstrap on read.
  if (redis) {
    try {
      const cached = await redis.get<IanaBootstrap>(BOOTSTRAP_CACHE_KEY);
      if (cached) {
        const map = parseBootstrap(cached);
        if (map) {
          _memo = { map, fetchedAt: Date.now() };
          return map;
        }
      }
    } catch {
      // cache miss / decode error — fall through to a live fetch
    }
  }

  // Live fetch from IANA (free static file).
  try {
    const res = await fetch(BOOTSTRAP_URL, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(BOOTSTRAP_FETCH_TIMEOUT_MS),
      ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
    });
    if (!res.ok) {
      logger.warn("RDAP bootstrap non-200", { status: res.status });
      return null;
    }
    const raw = (await res.json()) as IanaBootstrap;
    const map = parseBootstrap(raw);
    if (!map) {
      logger.warn("RDAP bootstrap parse failed");
      return null;
    }
    if (redis) {
      redis
        .set(BOOTSTRAP_CACHE_KEY, raw, { ex: BOOTSTRAP_TTL })
        .catch(() => {});
    }
    _memo = { map, fetchedAt: Date.now() };
    return map;
  } catch (err) {
    logger.warn("RDAP bootstrap fetch error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Two-tier cached bootstrap map. Returns null when unavailable (no Redis AND
 * data.iana.org unreachable/invalid) so the caller falls through to rdap.org.
 * Never throws.
 */
export async function getRdapBootstrap(): Promise<Map<string, string> | null> {
  if (_memo && Date.now() - _memo.fetchedAt < MEMO_TTL_MS) return _memo.map;
  if (_inflight) return _inflight;
  _inflight = loadBootstrap().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

/** Test-only: reset module cache state between cases. */
export function __resetBootstrapCacheForTests(): void {
  _memo = null;
  _inflight = null;
  _redis = null;
}
