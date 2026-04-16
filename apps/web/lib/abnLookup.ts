import { Redis } from "@upstash/redis";
import { logger } from "@askarthur/utils/logger";

export interface ABNLookupResult {
  abn: string;
  entityName: string;
  entityType: string;
  status: string;
  state: string | null;
  postcode: string | null;
}

const ABR_ENDPOINT =
  "https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/SearchByABNv202001";
const CACHE_TTL = 60 * 60 * 24; // 24 hours

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
  const cacheKey = `askarthur:abn:${abn}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<ABNLookupResult>(cacheKey);
      if (cached) return cached;
    } catch (err) {
      logger.error("Redis cache read failed for ABN lookup", { error: String(err) });
    }
  }

  const guid = process.env.ABR_GUID;
  if (!guid) {
    logger.error("ABR_GUID not configured");
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
    };

    if (redis) {
      redis.set(cacheKey, result, { ex: CACHE_TTL }).catch((err) =>
        logger.error("Redis cache write failed for ABN lookup", { error: String(err) })
      );
    }

    return result;
  } catch (err) {
    logger.error("ABN lookup failed", { error: String(err), abn });
    return null;
  }
}
