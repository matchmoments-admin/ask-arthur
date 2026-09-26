// The single seam that decides where domain-registration data comes from.
// RDAP-first (free, unmetered, richer — statuses / IANA id / abuse contact),
// falling back to whoisjson (1,000/month free tier) only when RDAP produced no
// record: no RDAP server for the TLD, an error, or a registry 404 that
// persisted through one retry (registries 404 transiently under bursts — .shop
// fallbacks found data 41% of the time, 2026-09-26). An RDAP record, even one
// without a registrar, is final (it carries statuses + name servers). The
// fallback is subject to whoisjson's monthly guard at the caller's priority;
// a fallback that got no answer (guard spent, non-200, no key) comes back as
// `source: "deferred"` + `retryAfter`, never as a final empty record (#1253).
// Gated by
// FF_RDAP_LOOKUP so it's a no-op (whoisjson only, byte-identical to before)
// until canaried.
//
// Consolidating the primary/fallback policy HERE (not in each caller) is the
// point: clone-watch attribution, and any future consumer, get the same
// resolution without duplicating it. whois-cached.ts (shop-signal /
// charity-check) intentionally stays on whoisjson this wave.

import {
  lookupWhois,
  type WhoisDeferralReason,
  type WhoisPriority,
  type WhoisResult,
} from "./whois";
import { lookupRdapOutcome, type RdapResult } from "./rdap";
import { featureFlags } from "@askarthur/utils/feature-flags";

export interface DomainRegistration extends WhoisResult {
  /** Raw EPP status strings; clientHold/serverHold ⇒ registrar-suspended. */
  statuses: string[];
  registrarIanaId: string | null;
  abuseContact: { email: string | null; phone: string | null } | null;
  /**
   * `deferred` (#1253): RDAP had no record AND whoisjson gave no answer (its
   * monthly guard is spent, it errored, or no key) — ask again at
   * `retryAfter`. Distinct from `whoisjson` with a null registrar, which is a
   * served answer and final.
   */
  source: "rdap" | "whoisjson" | "none" | "deferred";
  /** Only when source is `deferred`: ISO time a retry may get an answer. */
  retryAfter?: string;
  /** Only when source is `deferred`: why (whois.ts WhoisDeferralReason). */
  deferralReason?: WhoisDeferralReason;
}

/** A WhoisResult (whoisjson) widened to the DomainRegistration shape. An
 *  unanswered lookup keeps its deferral as `source: "deferred"`. */
function fromWhois(w: WhoisResult): DomainRegistration {
  const { deferral, ...rest } = w;
  return {
    ...rest,
    statuses: [],
    registrarIanaId: null,
    abuseContact: w.registrarAbuseEmail
      ? { email: w.registrarAbuseEmail, phone: null }
      : null,
    ...(deferral
      ? {
          source: "deferred" as const,
          retryAfter: deferral.retryAfter,
          deferralReason: deferral.reason,
        }
      : { source: "whoisjson" as const }),
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
  opts: { priority?: WhoisPriority } = {},
): Promise<DomainRegistration> {
  if (featureFlags.rdapLookup) {
    const { result: rdap, outcome } = await lookupRdapOutcome(domain).catch(
      () => ({ result: null, outcome: "error" as const }),
    );
    if (rdap && !rdapIsEmpty(rdap)) return fromRdap(rdap);
    // An RDAP record is final — no whoisjson call. A record without
    // registrar/created date still carries statuses + name servers.
    if (outcome === "found") return rdap ? fromRdap(rdap) : NONE;
    // not_found (after one retry) / no_server / error → whoisjson may answer.
  }

  const whois = await lookupWhois(domain, { priority: opts.priority }).catch(
    () => null,
  );
  if (!whois) return NONE;
  return fromWhois(whois);
}
