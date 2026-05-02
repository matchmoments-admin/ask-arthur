// ABR (Australian Business Register) Lookup wrapper.
//
// Wraps the public SearchByABN endpoint at abr.business.gov.au with a
// 24-hour Redis cache and a tolerant XML parser. Originally lived at
// apps/web/lib/abnLookup.ts; promoted to a workspace package in 2026-05
// when the charity-check engine became a second consumer (extending the
// result with DGR + ACNC + tax-concession fields). Cache key is
// versioned so adding fields safely invalidates stale entries.

import { Redis } from "@upstash/redis";

import { logger } from "@askarthur/utils/logger";

export interface ABNLookupResult {
  abn: string;
  entityName: string;
  entityType: string;
  status: string;
  state: string | null;
  postcode: string | null;
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

const ABR_ENDPOINT =
  "https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/SearchByABNv202001";
const CACHE_TTL = 60 * 60 * 24; // 24 hours
// Bumped when ABNLookupResult fields change so old cache entries don't
// satisfy reads expecting the new shape. Increment on schema additions.
const CACHE_VERSION = 2;

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

function extractEntityName(xml: string): string | null {
  const orgName = extractTag(xml, "organisationName");
  if (orgName) return orgName;

  const mainNameBlock = xml.match(/<mainName>([\s\S]*?)<\/mainName>/i);
  if (mainNameBlock) {
    return extractTag(mainNameBlock[1], "organisationName");
  }

  return null;
}

export async function lookupABN(abn: string): Promise<ABNLookupResult | null> {
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
    return null;
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
      return null;
    }

    const xml = await response.text();

    const entityName = extractEntityName(xml);
    if (!entityName) {
      logger.warn("ABN not found or no entity name returned", { abn });
      return null;
    }

    const result: ABNLookupResult = {
      abn,
      entityName,
      entityType: extractTag(xml, "entityTypeText") ?? "Unknown",
      status: extractTag(xml, "entityStatusCode") ?? "Unknown",
      state: extractTag(xml, "stateCode"),
      postcode: extractTag(xml, "postcode"),
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
    return null;
  }
}
