// RDAP (RFC 9083) domain lookup — free, unmetered registry data via the
// rdap.org bootstrap redirector. Complements whoisjson (near-exhausted 1,000/mo
// free tier) as the PRIMARY registration source for clone-watch attribution,
// and adds fields whoisjson doesn't surface:
//   - domain `statuses` (EPP status codes) — clientHold/serverHold means the
//     registrar has already SUSPENDED the domain, direct takedown evidence.
//   - registrar IANA ID — a stable registrar identifier for campaign grouping.
//   - a structured registrar abuse contact (email + phone).
//
// rdap.org 302-redirects to the authoritative registry RDAP server (chosen from
// IANA's bootstrap by TLD). The redirect target is registry-operated infra, not
// attacker-controlled, but we still dial through ssrfSafeDispatcher so a
// compromised/hostile redirect can't reach internal IPs.

import { logger } from "@askarthur/utils/logger";
import { logCost } from "./cost-log";
import { ssrfSafeDispatcher } from "./ssrf-dispatcher";

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

interface RdapDomain {
  status?: string[];
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  nameservers?: Array<{ ldhName?: string }>;
  entities?: RdapEntity[];
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
export function parseRdapResponse(json: RdapDomain, domain: string): RdapResult {
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
    abuseEmail || abusePhone
      ? { email: abuseEmail, phone: abusePhone }
      : null;

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

/**
 * Look up RDAP for a domain. Returns null when the domain is unregistered,
 * the TLD has no RDAP server, or the request fails — the caller falls back to
 * whoisjson. Free/unmetered; logged at estimatedCostUsd 0 for volume visibility.
 */
export async function lookupRdap(domain: string): Promise<RdapResult | null> {
  try {
    const res = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      {
        headers: { accept: "application/rdap+json" },
        signal: AbortSignal.timeout(8000),
        // undici's `dispatcher` isn't in the DOM fetch types — spread it in the
        // same way as fetchShopPage / redirect-resolver.
        ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
      },
    );

    if (!res.ok) {
      // 404 = unregistered / unsupported TLD (common, not an error).
      if (res.status !== 404) {
        logger.warn("RDAP lookup non-200", { status: res.status, domain });
      }
      return null;
    }

    void logCost({
      feature: "whois",
      provider: "rdap",
      operation: "domain-lookup",
      units: 1,
      estimatedCostUsd: 0,
    });

    const json = (await res.json()) as RdapDomain;
    return parseRdapResponse(json, domain);
  } catch (err) {
    logger.warn("RDAP lookup error", {
      error: err instanceof Error ? err.message : String(err),
      domain,
    });
    return null;
  }
}
