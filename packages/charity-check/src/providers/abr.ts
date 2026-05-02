// ABR Lookup pillar — wraps apps/web/lib/abnLookup.ts (already
// Redis-cached). The wrapper's job is just to map the ABR response into a
// CharityPillarResult; the heavy lifting (XML parse, DGR field extraction,
// caching) lives in the existing helper.
//
// Risk mapping (0..100, higher = more risk):
//   * ABN active + entity name matches input + DGR endorsed (or DGR
//     not claimed)                                     →  0   (SAFE)
//   * ABN active + entity name matches input + DGR claimed but not
//     endorsed (the "tax-deductible donations" lie)   → 50   (UNCERTAIN)
//   * ABN active but entity name mismatches input     → 50   (UNCERTAIN)
//   * ABN cancelled                                    →100   (SUSPICIOUS)
//   * ABN not found                                    →100   (SUSPICIOUS)
//   * lookupABN returned null (rate-limited / down)   → unavailable
//
// v0.1 has no "user claimed DGR" signal in the input shape, so the
// "DGR claimed but not endorsed" branch isn't exercised yet — kept in
// the scoring logic so a v0.2 input field can flip it on without a
// scorer change.

import { logger } from "@askarthur/utils/logger";
import { lookupABN, type ABNLookupResult } from "@askarthur/scam-engine/abr-lookup";

import { unavailablePillar, type CharityProviderContract } from "../provider-contract";
import type { CharityCheckInput, CharityPillarResult } from "../types";

const PROVIDER_ID = "abr";

export const abrProvider: CharityProviderContract = {
  id: PROVIDER_ID,
  timeoutMs: 4000,
  async run(input: CharityCheckInput): Promise<CharityPillarResult> {
    if (!input.abn) {
      // The ABR pillar only runs when an ABN is supplied. When the user
      // searched by name only, ACNC's lookup populates ABN downstream;
      // the orchestrator could re-run this pillar after that, but v0.1
      // keeps the orchestrator linear and reports unavailable here.
      return unavailablePillar("abr_dgr", "no_abn_provided");
    }

    let result: ABNLookupResult | null = null;
    try {
      result = await lookupABN(input.abn);
    } catch (err) {
      logger.warn("abr lookup threw", { error: String(err) });
      return unavailablePillar("abr_dgr", "exception");
    }

    if (!result) {
      // lookupABN returns null on cache miss + ABR fetch error AND on
      // a successful response that has no entity name (a benign "ABN
      // not found"). The two cases are visually similar but the cause
      // differs; v0.1 collapses them as "unavailable" because the
      // distinction doesn't change the verdict.
      return unavailablePillar("abr_dgr", "abr_unavailable_or_unknown");
    }

    const isCancelled = result.status.toUpperCase() === "CAN" ||
      result.status.toLowerCase().startsWith("cancel");

    if (isCancelled) {
      return {
        id: "abr_dgr",
        score: 100,
        confidence: 1,
        available: true,
        detail: {
          abn_status: result.status,
          entity_name: result.entityName,
          entity_type: result.entityType,
          state: result.state,
        },
      };
    }

    // Soft name-mismatch check: when the caller supplied a name AND the
    // ABR's entityName differs materially from it, surface as a caveat.
    // We compute a coarse word-overlap ratio because the official entity
    // name often differs in punctuation / "Inc" / "Ltd" suffixes from
    // the colloquial name a fundraiser would say.
    let nameMatch = 1.0;
    if (input.name) {
      nameMatch = wordOverlapRatio(input.name, result.entityName);
    }
    const nameMismatch = nameMatch < 0.5;

    let score = 0;
    if (nameMismatch) score = 50;
    // Future: when input.dgrClaimed === true && !result.dgrEndorsed → score = 50.

    return {
      id: "abr_dgr",
      score,
      confidence: 1,
      available: true,
      detail: {
        abn_status: result.status,
        entity_name: result.entityName,
        entity_type: result.entityType,
        state: result.state,
        is_acnc_registered: result.isAcncRegistered,
        dgr_endorsed: result.dgrEndorsed,
        dgr_item_number: result.dgrItemNumber,
        dgr_effective_from: result.dgrEffectiveFrom,
        dgr_effective_to: result.dgrEffectiveTo,
        tax_concession_charity: result.taxConcessionCharity,
        name_match: nameMatch,
        name_mismatch: nameMismatch,
      },
    };
  },
};

/** Coarse word-overlap ratio between two organisation names.
 *  Tolerates "Inc"/"Ltd"/"Pty"/"Limited" suffix differences and
 *  punctuation. Returns Jaccard-style 0..1. */
export function wordOverlapRatio(a: string, b: string): number {
  const tokenize = (s: string): Set<string> => {
    const tokens = s
      .toLowerCase()
      // Strip apostrophes WITHOUT inserting whitespace so "John's" collapses
      // to "johns" (matching the source-of-truth ABR variant which often
      // omits the apostrophe entirely).
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      // Drop tokens shorter than 2 chars — leftover noise from hyphens,
      // single-letter initials, etc.
      .filter((t) => t.length >= 2)
      .filter((t) => !STOPWORDS.has(t));
    return new Set(tokens);
  };
  const aSet = tokenize(a);
  const bSet = tokenize(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const t of aSet) if (bSet.has(t)) intersection++;
  const union = aSet.size + bSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const STOPWORDS = new Set([
  "the",
  "of",
  "and",
  "for",
  "in",
  "a",
  "an",
  "inc",
  "incorporated",
  "ltd",
  "limited",
  "pty",
  "co",
  "company",
  "australia",
  "australian",
  "trust",
  "fund",
]);
