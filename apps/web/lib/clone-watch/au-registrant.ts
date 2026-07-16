import type { AuRegistrantRaw } from "@askarthur/scam-engine/rdap-au";
import type {
  ABNLookupResult,
  AbnLookupFailure,
} from "@askarthur/scam-engine/abr-lookup";

/**
 * The `.au` registrant block stored under attribution.au_registrant. Combines
 * what auDA discloses over RDAP (registrant legal name + ABN) with the ABR
 * register verdict, so a `.au` lookalike registered to a CANCELLED or
 * MISMATCHED ABN is flagged — a rare literal "who + is-it-legit" for a clone.
 */
export interface AuRegistrantBlock {
  /** Registrant legal name (auDA RDAP). PII guard: only populated when an ABN
   *  or ACN is present, i.e. a business entity, never a bare individual. */
  legalName: string | null;
  abn: string | null;
  /** ABR verdict for the disclosed ABN. `lookup-failed` MUST NOT be read as
   *  cancelled/not-found (ADR-0009) — it's "we couldn't check", not a signal. */
  abnStatus:
    | "active"
    | "cancelled"
    | "not-found"
    | "lookup-failed"
    | "no-abn";
  /** eligibility type from auDA (Company / Registered Business / …). */
  entityType: string | null;
  /** Entity name as the ABR register holds it (for the mismatch cross-check). */
  entityName: string | null;
  /** Does the auDA-disclosed registrant name match the ABR entity/business
   *  names? null when either side is missing. false is a weaponisation signal. */
  nameMatchesAbn: boolean | null;
  checked_at: string;
}

/** Uppercase, strip punctuation + common company suffixes, collapse spaces. */
function normaliseEntity(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(PTY|LTD|LIMITED|PROPRIETARY|INC|CO|THE)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isFailure(
  r: ABNLookupResult | AbnLookupFailure,
): r is AbnLookupFailure {
  return "reason" in r;
}

/**
 * Assemble the au_registrant block. `abr` is the ABR lookup result for
 * `raw.abn` (null when no ABN was present to look up). Pure — unit-testable.
 */
export function buildAuRegistrantBlock(
  raw: AuRegistrantRaw | null,
  abr: ABNLookupResult | AbnLookupFailure | null,
  now: Date = new Date(),
): AuRegistrantBlock | null {
  if (!raw) return null;

  // PII guard: keep the disclosed legal name only alongside a business
  // identifier (ABN/ACN). Without one it could be a sole trader's personal
  // name — drop it.
  const legalName = raw.abn ? raw.registrantName : null;

  let abnStatus: AuRegistrantBlock["abnStatus"];
  let entityName: string | null = null;
  let nameMatchesAbn: boolean | null = null;

  if (!raw.abn) {
    abnStatus = "no-abn";
  } else if (!abr) {
    abnStatus = "lookup-failed";
  } else if (isFailure(abr)) {
    abnStatus = abr.reason; // "not-found" | "lookup-failed" — never "cancelled"
  } else {
    // ABR success. status is "Active" / "Cancelled" (occasionally other).
    const s = abr.status?.toLowerCase();
    abnStatus = s === "active" ? "active" : s === "cancelled" ? "cancelled" : "active";
    entityName = abr.entityName ?? null;

    if (raw.registrantName && (abr.entityName || abr.businessNames?.length)) {
      const want = normaliseEntity(raw.registrantName);
      const candidates = [abr.entityName, ...(abr.businessNames ?? [])]
        .filter(Boolean)
        .map((n) => normaliseEntity(n as string));
      nameMatchesAbn = candidates.some(
        (c) => c === want || c.includes(want) || want.includes(c),
      );
    }
  }

  return {
    legalName,
    abn: raw.abn,
    abnStatus,
    entityType: raw.entityType,
    entityName,
    nameMatchesAbn,
    checked_at: now.toISOString(),
  };
}
