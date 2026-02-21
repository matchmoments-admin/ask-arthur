// WHOIS enrichment via whoisjson.com (1,000 free/month, no credit card)
// Domain-level lookup — cached in scam_urls DB to avoid redundant calls.

import { logger } from "@askarthur/utils/logger";

export interface WhoisResult {
  registrar: string | null;
  registrantCountry: string | null;
  createdDate: string | null;   // ISO date string (YYYY-MM-DD)
  expiresDate: string | null;   // ISO date string (YYYY-MM-DD)
  nameServers: string[];
  isPrivate: boolean;
  raw: Record<string, unknown> | null;
}

const EMPTY_RESULT: WhoisResult = {
  registrar: null,
  registrantCountry: null,
  createdDate: null,
  expiresDate: null,
  nameServers: [],
  isPrivate: false,
  raw: null,
};

/**
 * Look up WHOIS data for a domain via whoisjson.com.
 * Free tier: 1,000 requests/month, 20 req/min rate limit.
 * 5s timeout, non-blocking — failures return empty result.
 */
export async function lookupWhois(domain: string): Promise<WhoisResult> {
  const apiKey = process.env.WHOIS_API_KEY;
  if (!apiKey) {
    logger.warn("WHOIS_API_KEY not set, skipping WHOIS lookup");
    return EMPTY_RESULT;
  }

  try {
    const res = await fetch(
      `https://whoisjson.com/api/v1/whois?domain=${encodeURIComponent(domain)}`,
      {
        headers: {
          Authorization: `TOKEN=${apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      logger.warn("WHOIS lookup failed", { status: res.status, domain });
      return EMPTY_RESULT;
    }

    const data = await res.json();

    // Extract structured fields — whoisjson.com uses these common field names
    const registrar =
      data.registrar || data.registrar_name || data.registrar?.name || null;
    const registrantCountry =
      data.registrant_country || data.registrant?.country || data.country || null;

    const createdDate = parseDate(
      data.creation_date || data.created || data.created_date || data.registered
    );
    const expiresDate = parseDate(
      data.expiration_date || data.expires || data.registry_expiry_date || data.expires_date
    );

    const rawNameServers = data.name_servers || data.nameservers || data.name_server || [];
    const nameServers = (Array.isArray(rawNameServers) ? rawNameServers : [rawNameServers])
      .filter(Boolean)
      .map((ns: string) => String(ns).toLowerCase());

    // Privacy detection: check for common privacy/proxy indicators
    const rawStr = JSON.stringify(data).toLowerCase();
    const isPrivate =
      rawStr.includes("privacy") ||
      rawStr.includes("whoisguard") ||
      rawStr.includes("redacted") ||
      rawStr.includes("domains by proxy") ||
      rawStr.includes("contact privacy");

    return {
      registrar: typeof registrar === "string" ? registrar : null,
      registrantCountry: typeof registrantCountry === "string" ? registrantCountry : null,
      createdDate,
      expiresDate,
      nameServers,
      isPrivate,
      raw: data,
    };
  } catch (err) {
    logger.error("WHOIS lookup error", { error: String(err), domain });
    return EMPTY_RESULT;
  }
}

/** Parse a date string into ISO date format (YYYY-MM-DD), or null */
function parseDate(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return null;
  }
}
