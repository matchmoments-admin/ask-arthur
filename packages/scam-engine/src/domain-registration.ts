// The single seam that decides where domain-registration data comes from.
// RDAP-first (free, unmetered, richer — statuses / IANA id / abuse contact),
// falling back to whoisjson only when RDAP has nothing useful. Gated by
// FF_RDAP_LOOKUP so it's a no-op (whoisjson only, byte-identical to before)
// until canaried.
//
// Consolidating the primary/fallback policy HERE (not in each caller) is the
// point: clone-watch attribution, and any future consumer, get the same
// resolution without duplicating it. whois-cached.ts (shop-signal /
// charity-check) intentionally stays on whoisjson this wave.

import { lookupWhois, type WhoisResult } from "./whois";
import { lookupRdap } from "./rdap";
import { featureFlags } from "@askarthur/utils/feature-flags";

export interface DomainRegistration extends WhoisResult {
  /** Raw EPP status strings; clientHold/serverHold ⇒ registrar-suspended. */
  statuses: string[];
  registrarIanaId: string | null;
  abuseContact: { email: string | null; phone: string | null } | null;
  source: "rdap" | "whoisjson" | "none";
}

/** A WhoisResult (whoisjson) widened to the DomainRegistration shape. */
function fromWhois(w: WhoisResult): DomainRegistration {
  return {
    ...w,
    statuses: [],
    registrarIanaId: null,
    abuseContact: w.registrarAbuseEmail
      ? { email: w.registrarAbuseEmail, phone: null }
      : null,
    source: "whoisjson",
  };
}

/** True when RDAP returned nothing we'd act on (so we should fall back). */
function rdapIsEmpty(r: {
  registrar: string | null;
  createdDate: string | null;
}): boolean {
  return !r.registrar && !r.createdDate;
}

export async function lookupDomainRegistration(
  domain: string,
): Promise<DomainRegistration> {
  if (featureFlags.rdapLookup) {
    const rdap = await lookupRdap(domain).catch(() => null);
    if (rdap && !rdapIsEmpty(rdap)) {
      return {
        registrar: rdap.registrar,
        registrarAbuseEmail: rdap.abuseContact?.email ?? null,
        registrantCountry: rdap.registrantCountry,
        createdDate: rdap.createdDate,
        expiresDate: rdap.expiresDate,
        nameServers: rdap.nameServers,
        isPrivate: rdap.isPrivate,
        raw: null,
        statuses: rdap.statuses,
        registrarIanaId: rdap.registrarIanaId,
        abuseContact: rdap.abuseContact,
        source: "rdap",
      };
    }
    // RDAP empty/failed → whoisjson fallback (preserves the near-exhausted
    // quota for exactly these hard cases).
  }

  const whois = await lookupWhois(domain).catch(() => null);
  if (!whois) {
    return {
      registrar: null,
      registrarAbuseEmail: null,
      registrantCountry: null,
      createdDate: null,
      expiresDate: null,
      nameServers: [],
      isPrivate: false,
      raw: null,
      statuses: [],
      registrarIanaId: null,
      abuseContact: null,
      source: "none",
    };
  }
  return fromWhois(whois);
}
