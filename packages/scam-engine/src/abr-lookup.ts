// ABR (Australian Business Register) Lookup wrapper.
//
// Wraps the public SearchByABN endpoint at abr.business.gov.au with a
// 24-hour Redis cache and a tolerant XML parser. Originally lived at
// apps/web/lib/abnLookup.ts; promoted to a workspace package in 2026-05
// when the charity-check engine became a second consumer (extending the
// result with DGR + ACNC + tax-concession fields). Cache key is
// versioned so adding fields safely invalidates stale entries.
//
// lookupABN returns a DISCRIMINATED result, never a bare null. A genuine
// "this ABN is not on the register" (`not-found`) is a real signal; a
// service error / bad GUID / unparseable response (`lookup-failed`) is
// NOT. Conflating the two let a transient ABR outage be reported to a
// user as "ABN unregistered" — see GitHub #349 (F-A). Callers must
// distinguish them: discriminate on `"ok" in result`.

import { Redis } from "@upstash/redis";

import { logger } from "@askarthur/utils/logger";

export interface ABNLookupResult {
  abn: string;
  entityName: string;
  entityType: string;
  status: string;
  state: string | null;
  postcode: string | null;
  /** Registered business / trading names from the ABR response
   *  (`<businessName>`, `<mainTradingName>`, `<otherTradingName>`). A shop
   *  legitimately trading under a registered business name that differs
   *  from its legal entity name is matched against these as well as
   *  `entityName`. */
  businessNames: string[];
  /** True when the ABR record reports an active ACNC registration. The
   *  flag is sufficient for the verdict screen — full ACNC details come
   *  from the local mirror in `acnc_charities`. */
  isAcncRegistered: boolean;
  /** True when at least one Deductible Gift Recipient endorsement is
   *  active as of the lookup time. Most fundraising charities that
   *  legitimately solicit "tax-deductible donations" carry one. */
  dgrEndorsed: boolean;
  /** ATO DGR Item Number for the active endorsement, if present. Useful
   *  for B2B / compliance audiences; non-essential for the consumer UI. */
  dgrItemNumber: string | null;
  /** Earliest endorsement start date across DGR endorsements (ISO date),
   *  if present. */
  dgrEffectiveFrom: string | null;
  /** Latest endorsement end date across DGR endorsements (ISO date), if
   *  present. NULL on open-ended endorsements. */
  dgrEffectiveTo: string | null;
  /** True when the ABR record reports an active Tax Concession Charity
   *  endorsement (income tax exempt). Surface alongside DGR for the
   *  fuller charity-tax picture. */
  taxConcessionCharity: boolean;
}

/**
 * A lookup that did not return a usable record.
 *
 * - `not-found`     — ABR answered cleanly and the ABN is simply not on
 *                     the register. A real signal: the displayed ABN is
 *                     unregistered.
 * - `lookup-failed` — the lookup could not complete: missing GUID, a
 *                     non-OK HTTP status, an `<exception>` body (bad
 *                     GUID, malformed ABN, ABR service error), malformed
 *                     XML, or a thrown error. This is NOT evidence the
 *                     ABN is unregistered — the caller must not treat it
 *                     as one.
 */
export interface AbnLookupFailure {
  ok: false;
  reason: "not-found" | "lookup-failed";
}

const ABR_ENDPOINT =
  "https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/SearchByABNv202001";
const CACHE_TTL = 60 * 60 * 24; // 24 hours
// Bumped when ABNLookupResult fields change so old cache entries don't
// satisfy reads expecting the new shape. Increment on schema additions.
// v3: added `businessNames`.
const CACHE_VERSION = 3;

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const match = xml.match(regex);
  return match?.[1]?.trim() || null;
}

/**
 * Extract charity-related fields from the ABR XML response.
 *
 * The ABR response shape varies by entity type — some charities return a
 * top-level `<dgrEndorsement>` block, others nest one or more
 * `<dgrEndorsement>` entries inside `<dgr>`. We tolerate both shapes by
 * matching all `<dgrEndorsement>` occurrences in the document and picking
 * the earliest-start / latest-end pair.
 *
 * `<acncRegistration>` and `<taxConcessionCharityEndorsement>` are simpler
 * — single-occurrence presence/status flags.
 */
export function extractCharityFields(xml: string): {
  isAcncRegistered: boolean;
  dgrEndorsed: boolean;
  dgrItemNumber: string | null;
  dgrEffectiveFrom: string | null;
  dgrEffectiveTo: string | null;
  taxConcessionCharity: boolean;
} {
  // ACNC: status==='Registered' inside the <acncRegistration> block.
  const acncBlock = xml.match(/<acncRegistration\b[\s\S]*?<\/acncRegistration>/i)?.[0] ?? "";
  const isAcncRegistered = acncBlock
    ? (extractTag(acncBlock, "status") ?? "").trim().toLowerCase() === "registered"
    : false;

  const dgrBlocks = xml.match(/<dgrEndorsement\b[\s\S]*?<\/dgrEndorsement>/gi) ?? [];
  let dgrEndorsed = false;
  let dgrItemNumber: string | null = null;
  let dgrEffectiveFrom: string | null = null;
  let dgrEffectiveTo: string | null = null;
  const today = new Date().toISOString().slice(0, 10);

  for (const block of dgrBlocks) {
    const from = extractTag(block, "endorsedFrom");
    const to = extractTag(block, "endorsedTo");
    const itemNumber =
      extractTag(block, "itemNumber") ??
      extractTag(block, "endorsementType");
    // Active = endorsedFrom in past AND (endorsedTo absent OR in future).
    const startedActive = from && from <= today;
    const stillActive = !to || to >= today;
    if (startedActive && stillActive) {
      dgrEndorsed = true;
      if (!dgrItemNumber && itemNumber) dgrItemNumber = itemNumber;
      if (!dgrEffectiveFrom || (from && from < dgrEffectiveFrom)) dgrEffectiveFrom = from;
      // For end date, NULL (open-ended) wins over any specific date.
      if (to === null || to === undefined) dgrEffectiveTo = null;
      else if (dgrEffectiveTo !== null && (!dgrEffectiveTo || to > dgrEffectiveTo)) {
        dgrEffectiveTo = to;
      }
    }
  }

  // Fallback: some responses surface DGR via a top-level
  // `<deductibleGiftRecipientStatusCode>Y</deductibleGiftRecipientStatusCode>`
  // without a nested block. Treat as endorsed but with null dates.
  if (!dgrEndorsed) {
    const code = extractTag(xml, "deductibleGiftRecipientStatusCode");
    if (code && code.toUpperCase() === "Y") dgrEndorsed = true;
  }

  // Tax concession charity — simpler presence/status check.
  const tccBlock =
    xml.match(/<taxConcessionCharityEndorsement\b[\s\S]*?<\/taxConcessionCharityEndorsement>/i)?.[0] ??
    "";
  let taxConcessionCharity = false;
  if (tccBlock) {
    const from = extractTag(tccBlock, "endorsedFrom");
    const to = extractTag(tccBlock, "endorsedTo");
    const startedActive = from && from <= today;
    const stillActive = !to || to >= today;
    if (startedActive && stillActive) taxConcessionCharity = true;
  }

  return {
    isAcncRegistered,
    dgrEndorsed,
    dgrItemNumber,
    dgrEffectiveFrom,
    dgrEffectiveTo,
    taxConcessionCharity,
  };
}

/**
 * Extract the entity name from an ABR `SearchByABNv202001` response.
 *
 * Per the ABR XSD, a `ResponseBusinessEntity` carries EITHER
 * `<mainName><organisationName>` (organisations) OR `<legalName>` with
 * individual name parts (individuals / sole traders). A large share of
 * small AU online shops trade as sole traders, so the `legalName` branch
 * is load-bearing — its absence was the dominant driver of false
 * `unregistered` verdicts (GitHub #349, F-A / H2).
 */
export function extractEntityName(xml: string): string | null {
  const mainName = xml.match(/<mainName\b[\s\S]*?<\/mainName>/i)?.[0];
  if (mainName) {
    const org = extractTag(mainName, "organisationName");
    if (org) return org;
  }

  const legalName = xml.match(/<legalName\b[\s\S]*?<\/legalName>/i)?.[0];
  if (legalName) {
    const full = extractTag(legalName, "fullName");
    if (full) return full;
    const parts = [
      extractTag(legalName, "givenName"),
      extractTag(legalName, "otherGivenName"),
      extractTag(legalName, "familyName"),
    ].filter((p): p is string => Boolean(p));
    if (parts.length > 0) return parts.join(" ");
  }

  return null;
}

/**
 * Registered business / trading names from an ABR response — every
 * `<organisationName>` inside a `<businessName>`, `<mainTradingName>`, or
 * `<otherTradingName>` block (each repeatable per the XSD). Used as
 * additional targets for the shop brand-name match so a shop trading
 * under a registered business name that differs from its legal entity
 * name still verifies.
 */
export function extractBusinessNames(xml: string): string[] {
  const names: string[] = [];
  for (const tag of ["businessName", "mainTradingName", "otherTradingName"]) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi");
    for (const block of xml.match(re) ?? []) {
      const org = extractTag(block, "organisationName");
      if (org) names.push(org);
    }
  }
  return [...new Set(names)];
}

export async function lookupABN(
  abn: string,
): Promise<ABNLookupResult | AbnLookupFailure> {
  const cacheKey = `askarthur:abn:v${CACHE_VERSION}:${abn}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<ABNLookupResult>(cacheKey);
      if (cached) return cached;
    } catch (err) {
      logger.error("Redis cache read failed for ABN lookup", { error: String(err) });
    }
  }

  const guid = process.env.ABN_LOOKUP_GUID;
  if (!guid) {
    logger.error("ABN_LOOKUP_GUID not configured");
    return { ok: false, reason: "lookup-failed" };
  }

  try {
    const params = new URLSearchParams({
      searchString: abn,
      includeHistoricalDetails: "N",
      authenticationGuid: guid,
    });

    const response = await fetch(`${ABR_ENDPOINT}?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error("ABR API returned non-OK status", { status: response.status });
      return { ok: false, reason: "lookup-failed" };
    }

    const xml = await response.text();

    // An <exception> means the lookup could not complete — a bad/expired
    // GUID, a malformed search string, or an ABR service error. It is NOT
    // a clean "this ABN is unregistered" answer, so it must never be
    // reported as one. The two are indistinguishable without brittle
    // parsing of ABR's free-text exceptionDescription, so we take the
    // conservative path: treat every exception as `lookup-failed`.
    if (/<exception\b/i.test(xml)) {
      logger.warn("ABR returned an exception", {
        abn,
        detail: extractTag(xml, "exceptionDescription"),
      });
      return { ok: false, reason: "lookup-failed" };
    }

    const entityName = extractEntityName(xml);
    if (!entityName) {
      // A clean response with no entity — the ABN genuinely is not on the
      // register. This is the only path that yields `not-found`.
      logger.warn("ABN not found on the register", { abn });
      return { ok: false, reason: "not-found" };
    }

    const result: ABNLookupResult = {
      abn,
      entityName,
      // ABR nests the human-readable type under <entityType><entityDescription>;
      // there is no <entityTypeText> element (an earlier guess that left
      // every entityType reading "Unknown" — GitHub #349).
      entityType: extractTag(xml, "entityDescription") ?? "Unknown",
      status: extractTag(xml, "entityStatusCode") ?? "Unknown",
      state: extractTag(xml, "stateCode"),
      postcode: extractTag(xml, "postcode"),
      businessNames: extractBusinessNames(xml),
      ...extractCharityFields(xml),
    };

    if (redis) {
      redis.set(cacheKey, result, { ex: CACHE_TTL }).catch((err) =>
        logger.error("Redis cache write failed for ABN lookup", { error: String(err) }),
      );
    }

    return result;
  } catch (err) {
    logger.error("ABN lookup failed", { error: String(err), abn });
    return { ok: false, reason: "lookup-failed" };
  }
}
