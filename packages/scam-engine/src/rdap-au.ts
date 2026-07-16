// .au registrant identity from auDA RDAP. Australia is globally unusual: auDA
// discloses the registrant's LEGAL NAME + ABN over RDAP (in the auDA-specific
// `auData_eligibility` block, not a standard entity). For a .au lookalike this
// is a rare literal "who registered this" — and the ABN can be cross-checked
// against the free ABR register to catch cancelled / mismatched entities.
//
// Decoupled from FF_RDAP_LOOKUP on purpose: the .au registrant feature has its
// own flag and its own (free, unmetered, .au-only, capped-volume) RDAP fetch,
// so it works whether or not the generic RDAP-first migration is enabled.

import { fetchRdapDomain } from "./rdap";
import { isValidAbnChecksum } from "./abn-checksum";

export interface AuRegistrantRaw {
  /** Registrant legal entity name as auDA discloses it (may be null). */
  registrantName: string | null;
  /** 11-digit ABN (or 9-digit ACN) with separators stripped, checksum-valid. */
  abn: string | null;
  /** "Company" / "Registered Business" / etc. from the eligibility block. */
  entityType: string | null;
}

function eligibilityValue(
  rows: Array<{ name?: string; value?: string }> | undefined,
  name: string,
): string | null {
  if (!Array.isArray(rows)) return null;
  const row = rows.find((r) => (r.name ?? "").toLowerCase() === name);
  const v = row?.value?.trim();
  return v || null;
}

/** Pure parse of the auDA eligibility block → registrant identity. Exported for
 *  fixture tests. Only returns an ABN when it passes the ABR checksum, so a
 *  malformed "registrant id" never propagates as a real identifier. */
export function parseAuEligibility(
  rows: Array<{ name?: string; value?: string }> | undefined,
): AuRegistrantRaw | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const registrantName = eligibilityValue(rows, "registrant name");
  const entityType = eligibilityValue(rows, "eligibility type");
  // "registrant id" is typically "ABN 33051775556" (sometimes "ACN ...").
  const rawId =
    eligibilityValue(rows, "registrant id") ??
    eligibilityValue(rows, "eligibility id");
  let abn: string | null = null;
  if (rawId) {
    const digits = rawId.replace(/\D/g, "");
    // Only trust a checksum-valid 11-digit ABN (or a 9-digit ACN, which has no
    // ABR checksum). A malformed id never propagates as a real identifier.
    if (digits.length === 11 && isValidAbnChecksum(digits)) abn = digits;
    else if (digits.length === 9) abn = digits;
  }
  if (!registrantName && !abn && !entityType) return null;
  return { registrantName, abn, entityType };
}

/**
 * Fetch the .au registrant identity for a domain. Returns null for non-.au
 * domains (skip the call) or when auDA discloses nothing. Free + unmetered.
 */
export async function lookupAuRegistrant(
  domain: string,
): Promise<AuRegistrantRaw | null> {
  if (!domain.toLowerCase().endsWith(".au")) return null;
  const json = await fetchRdapDomain(domain);
  if (!json) return null;
  return parseAuEligibility(json.auData_eligibility);
}
