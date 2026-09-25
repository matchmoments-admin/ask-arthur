// RDAP (RFC 9083) domain lookup — free, unmetered registry data. The PRIMARY
// registration source for clone-watch attribution (complements whoisjson, whose
// 1,000/mo free tier is near-exhausted), and adds fields whoisjson doesn't
// surface:
//   - domain `statuses` (EPP status codes) — clientHold/serverHold means the
//     registrar has already SUSPENDED the domain, direct takedown evidence.
//   - registrar IANA ID — a stable registrar identifier for campaign grouping.
//   - a structured registrar abuse contact (email + phone).
//
// Primary path queries the authoritative registry RDAP server DIRECTLY, resolved
// from IANA's cached bootstrap by TLD (see rdap-bootstrap.ts) — the shared
// rdap.org redirector rate-limits our per-run burst and was silently dropping
// ~75% of RDAP-capable lookups to a timeout (measured prod 2026-07-18). rdap.org
// remains the fallback. Registry servers are registry-operated infra chosen from
// the IANA bootstrap (never attacker-derived); every fetch dials through
// ssrfSafeDispatcher so a compromised/hostile response can't reach internal IPs.

import { logger } from "@askarthur/utils/logger";
import { logCost } from "./cost-log";
import { ssrfSafeDispatcher } from "./ssrf-dispatcher";
import { assertSafeURL } from "./ssrf-guard";
import {
  getRdapBootstrap,
  resolveRegistryBase,
  buildRegistryDomainUrl,
} from "./rdap-bootstrap";

export interface RdapResult {
  registrar: string | null;
  registrarIanaId: string | null;
  /** Registrar abuse contact — the takedown surface. */
  abuseContact: { email: string | null; phone: string | null } | null;
  registrantCountry: string | null;
  createdDate: string | null; // ISO YYYY-MM-DD
  expiresDate: string | null; // ISO YYYY-MM-DD
  nameServers: string[];
  /** Raw EPP status strings, e.g. ["client transfer prohibited", "client hold"]. */
  statuses: string[];
  isPrivate: boolean;
  source: "rdap";
}

interface RdapEntity {
  roles?: string[];
  publicIds?: Array<{ type?: string; identifier?: string }>;
  vcardArray?: unknown;
  entities?: RdapEntity[];
}

export interface RdapDomain {
  status?: string[];
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  entities?: RdapEntity[];
  /** auDA extension: .au discloses registrant name + ABN here (not in an
   *  entity), e.g. [{name:"registrant name",value:"Telstra Corporation Ltd"},
   *  {name:"registrant id",value:"ABN 33051775556"}, ...]. */
  auData_eligibility?: Array<{ name?: string; value?: string }>;
  // RDAP responses carry many more fields than we model (objectClassName,
  // handle, links, notices, secureDNS, …). Tolerate them so real responses +
  // fixtures type-check without enumerating the whole RFC 9083 schema.
  [key: string]: unknown;
}

/**
 * jCard (RFC 7095) is `["vcard", [ [name, params, type, value], ... ]]`.
 * Pull the first value for a given property name (e.g. "fn", "email", "tel").
 */
function vcardValue(vcardArray: unknown, prop: string): string | null {
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return null;
  const entries = vcardArray[1];
  if (!Array.isArray(entries)) return null;
  for (const e of entries) {
    if (Array.isArray(e) && e[0] === prop) {
      const value = e[3];
      if (typeof value === "string" && value) return value;
      if (Array.isArray(value)) {
        const flat = value.filter(Boolean).join(", ");
        return flat || null;
      }
    }
  }
  return null;
}

function findEntity(
  entities: RdapEntity[] | undefined,
  role: string,
): RdapEntity | null {
  if (!Array.isArray(entities)) return null;
  for (const e of entities) {
    if (Array.isArray(e.roles) && e.roles.includes(role)) return e;
    // Registrar's abuse contact is nested one level under the registrar entity.
    const nested = findEntity(e.entities, role);
    if (nested) return nested;
  }
  return null;
}

function eventDate(
  events: RdapDomain["events"],
  action: string,
): string | null {
  if (!Array.isArray(events)) return null;
  const ev = events.find((e) => e.eventAction === action);
  if (!ev?.eventDate) return null;
  const d = new Date(ev.eventDate);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Pure parser — exported for fixture tests. */
export function parseRdapResponse(
  json: RdapDomain,
  domain: string,
): RdapResult {
  const registrarEntity = findEntity(json.entities, "registrar");
  const registrar = registrarEntity
    ? vcardValue(registrarEntity.vcardArray, "fn")
    : null;
  const registrarIanaId =
    registrarEntity?.publicIds?.find((p) =>
      (p.type ?? "").toLowerCase().includes("iana"),
    )?.identifier ?? null;

  const abuseEntity = registrarEntity
    ? findEntity(registrarEntity.entities, "abuse")
    : null;
  const abuseEmail = abuseEntity
    ? vcardValue(abuseEntity.vcardArray, "email")
    : null;
  const abusePhone = abuseEntity
    ? vcardValue(abuseEntity.vcardArray, "tel")
    : null;
  const abuseContact =
    abuseEmail || abusePhone ? { email: abuseEmail, phone: abusePhone } : null;

  const registrantEntity = findEntity(json.entities, "registrant");
  const registrantCountry = registrantEntity
    ? vcardValue(registrantEntity.vcardArray, "country-name")
    : null;

  const nameServers = Array.isArray(json.nameservers)
    ? json.nameservers
        .map((n) => (n.ldhName ? String(n.ldhName).toLowerCase() : null))
        .filter((n): n is string => !!n)
    : [];

  const statuses = Array.isArray(json.status)
    ? json.status.map((s) => String(s))
    : [];

  const rawStr = JSON.stringify(json).toLowerCase();
  const isPrivate =
    rawStr.includes("redacted") ||
    rawStr.includes("privacy") ||
    rawStr.includes("data protected");

  return {
    registrar,
    registrarIanaId,
    abuseContact,
    registrantCountry,
    createdDate: eventDate(json.events, "registration"),
    expiresDate: eventDate(json.events, "expiration"),
    nameServers,
    statuses,
    isPrivate,
    source: "rdap",
  };
}

/** What one RDAP GET said. `not_found` is a 404 — authoritative when it comes
 *  from the TLD's own registry server; `error` is anything else that failed
 *  (non-404 status, timeout, network), which proves nothing about the domain. */
type RdapGet =
  | { kind: "found"; json: RdapDomain }
  | { kind: "not_found" }
  | { kind: "error" };

/**
 * One RDAP GET, tagged. `via` tags the cost row so telemetry shows which path
 * served each success (registry-direct vs the rdap.org fallback). The registry
 * server (and rdap.org's 302 target) is dialed through ssrfSafeDispatcher so a
 * hostile response can't reach internal IPs.
 */
async function rdapGet(
  url: string,
  domain: string,
  via: "registry" | "rdap.org",
): Promise<RdapGet> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/rdap+json" },
      signal: AbortSignal.timeout(8000),
      // undici's `dispatcher` isn't in the DOM fetch types — spread it in the
      // same way as fetchShopPage / redirect-resolver.
      ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
    });

    if (!res.ok) {
      // 404 = unregistered / unsupported TLD (common, not an error).
      if (res.status === 404) return { kind: "not_found" };
      logger.warn("RDAP lookup non-200", { status: res.status, domain, via });
      return { kind: "error" };
    }

    void logCost({
      feature: "whois",
      provider: "rdap",
      operation: "domain-lookup",
      units: 1,
      estimatedCostUsd: 0,
      metadata: { via },
    });

    return { kind: "found", json: (await res.json()) as RdapDomain };
  } catch (err) {
    logger.warn("RDAP lookup error", {
      error: err instanceof Error ? err.message : String(err),
      domain,
      via,
    });
    return { kind: "error" };
  }
}

/**
 * How an RDAP lookup ended — the caller's fallback policy depends on it:
 *   - `found`      RDAP answered (the record may still lack a registrar).
 *   - `not_found`  the TLD's own registry RDAP server returned 404 — an
 *                  authoritative "no such registration"; whoisjson would say
 *                  the same thing and spend quota doing it.
 *   - `no_server`  the TLD has no registry RDAP server in the IANA bootstrap
 *                  (e.g. .ru) or the bootstrap is unavailable, and rdap.org had
 *                  nothing — RDAP can't answer for this name.
 *   - `error`      a lookup failed (timeout / non-404 status / network).
 */
export type RdapOutcome = "found" | "not_found" | "no_server" | "error";

/**
 * Low-level RDAP fetch → raw JSON plus how it ended. Shared by lookupRdap and
 * the .au registrant lookup so the fetch + SSRF-safe dispatch + cost log live in
 * one place.
 *
 * Fast path: resolve the TLD's registry RDAP server from IANA's cached bootstrap
 * and query it DIRECTLY (registry servers don't rate-limit our burst the way the
 * shared rdap.org redirector does — see rdap-bootstrap.ts). A registry 404 is
 * authoritative and ends the lookup (rdap.org would redirect to the same
 * registry and 404 again). On a registry ERROR, fall back to rdap.org — the
 * prior behaviour. The registry base comes only from the IANA bootstrap (never
 * attacker-derived), every fetch keeps ssrfSafeDispatcher, and the constructed
 * registry URL is also assertSafeURL-checked.
 */
export async function fetchRdapDomainOutcome(
  domain: string,
): Promise<{ json: RdapDomain | null; outcome: RdapOutcome }> {
  const bootstrap = await getRdapBootstrap();
  const base = bootstrap ? resolveRegistryBase(domain, bootstrap) : null;
  if (base) {
    try {
      const url = buildRegistryDomainUrl(base, domain);
      assertSafeURL(url); // throws → skip direct path, fall through to rdap.org
      const direct = await rdapGet(url, domain, "registry");
      if (direct.kind === "found") return { json: direct.json, outcome: "found" };
      if (direct.kind === "not_found") return { json: null, outcome: "not_found" };
      // Registry error: fall through to rdap.org (one extra request only on
      // the rare registry failure).
    } catch (err) {
      logger.warn("RDAP registry path skipped", {
        error: err instanceof Error ? err.message : String(err),
        domain,
      });
    }
  }

  const viaOrg = await rdapGet(
    `https://rdap.org/domain/${encodeURIComponent(domain)}`,
    domain,
    "rdap.org",
  );
  if (viaOrg.kind === "found") return { json: viaOrg.json, outcome: "found" };
  if (viaOrg.kind === "error") return { json: null, outcome: "error" };
  // rdap.org 404: authoritative only when the TLD has a registry server (it
  // redirects there); with no registry in the bootstrap it just means RDAP has
  // nothing for this TLD.
  return { json: null, outcome: base ? "not_found" : "no_server" };
}

/** Raw JSON (or null on 404/error) — the pre-outcome shape, kept for callers
 *  that don't need to know why (the .au registrant lookup). */
export async function fetchRdapDomain(
  domain: string,
): Promise<RdapDomain | null> {
  return (await fetchRdapDomainOutcome(domain)).json;
}

/** Parsed RDAP plus how the lookup ended — what the whoisjson fallback policy
 *  in domain-registration.ts needs. */
export async function lookupRdapOutcome(
  domain: string,
): Promise<{ result: RdapResult | null; outcome: RdapOutcome }> {
  const { json, outcome } = await fetchRdapDomainOutcome(domain);
  return { result: json ? parseRdapResponse(json, domain) : null, outcome };
}

/**
 * Look up RDAP for a domain. Returns null when the domain is unregistered,
 * the TLD has no RDAP server, or the request fails — the caller falls back to
 * whoisjson. Free/unmetered; logged at estimatedCostUsd 0 for volume visibility.
 */
export async function lookupRdap(domain: string): Promise<RdapResult | null> {
  const json = await fetchRdapDomain(domain);
  if (!json) return null;
  return parseRdapResponse(json, domain);
}
