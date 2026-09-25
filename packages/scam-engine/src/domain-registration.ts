// The single seam that decides where domain-registration data comes from.
// RDAP-first (free, unmetered, richer — statuses / IANA id / abuse contact),
// falling back to whoisjson (1,000/month free tier) ONLY when RDAP could not
// answer: the TLD has no RDAP server, or the lookup errored. A definitive RDAP
// answer — a record (even one without a registrar) or the registry's own 404 —
// is final; whoisjson would say the same and spend quota doing it (2026-09-26:
// ~40% of whoisjson calls were RDAP-supported TLDs re-asking after a 404). Gated by
// FF_RDAP_LOOKUP so it's a no-op (whoisjson only, byte-identical to before)
// until canaried.
//
// Consolidating the primary/fallback policy HERE (not in each caller) is the
// point: clone-watch attribution, and any future consumer, get the same
// resolution without duplicating it. whois-cached.ts (shop-signal /
// charity-check) intentionally stays on whoisjson this wave.

import { lookupWhois, type WhoisResult } from "./whois";
import { lookupRdapOutcome, type RdapResult } from "./rdap";
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

const NONE: DomainRegistration = {
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

function fromRdap(rdap: RdapResult): DomainRegistration {
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

export async function lookupDomainRegistration(
  domain: string,
): Promise<DomainRegistration> {
  if (featureFlags.rdapLookup) {
    const { result: rdap, outcome } = await lookupRdapOutcome(domain).catch(
      () => ({ result: null, outcome: "error" as const }),
    );
    if (rdap && !rdapIsEmpty(rdap)) return fromRdap(rdap);
    // A definitive RDAP answer is final — no whoisjson call. A record without
    // registrar/created date still carries statuses + name servers.
    if (outcome === "found") return rdap ? fromRdap(rdap) : NONE;
    if (outcome === "not_found") return NONE;
    // no_server / error → whoisjson is the only source that can answer.
  }

  const whois = await lookupWhois(domain).catch(() => null);
  if (!whois) return NONE;
  return fromWhois(whois);
}
