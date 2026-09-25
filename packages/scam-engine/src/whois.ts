// WHOIS enrichment via whoisjson.com (1,000 free/month, no credit card)
// Domain-level lookup — cached in scam_urls DB to avoid redundant calls.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { logCost } from "./cost-log";

export interface WhoisResult {
  registrar: string | null;
  /** Registrar abuse-report email (whoisjson `registrar.email`) — the takedown
   *  contact. High-value for clone-watch / takedown workflows. */
  registrarAbuseEmail: string | null;
  registrantCountry: string | null;
  createdDate: string | null; // ISO date string (YYYY-MM-DD)
  expiresDate: string | null; // ISO date string (YYYY-MM-DD)
  nameServers: string[];
  isPrivate: boolean;
  raw: Record<string, unknown> | null;
}

const EMPTY_RESULT: WhoisResult = {
  registrar: null,
  registrarAbuseEmail: null,
  registrantCountry: null,
  createdDate: null,
  expiresDate: null,
  nameServers: [],
  isPrivate: false,
  raw: null,
};

/**
 * Monthly quota guard. whoisjson's free tier is 1,000 lookups/month and the
 * fleet was running ~1,200–1,300 (2026-09 review): past the cap every caller
 * silently got nothing for the rest of the month. Stop at a margin below it so
 * the lookups that DO matter late in the month still have headroom next month
 * rather than failing unannounced. The count is this month's served lookups
 * (the `whois`/`whoisjson` cost rows this module writes), cached briefly per
 * instance and advanced locally after each call.
 */
export const WHOISJSON_MONTHLY_GUARD = 950;
const QUOTA_CACHE_MS = 10 * 60 * 1000;
let quotaCache: { month: string; count: number; fetchedAt: number } | null = null;
let lastGuardWarnMonth: string | null = null;

/** Reset the in-process quota cache — tests only. */
export function __resetWhoisQuotaCacheForTests(): void {
  quotaCache = null;
  lastGuardWarnMonth = null;
}

function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** This month's served whoisjson lookups, or null when the count can't be
 *  read (the guard then fails OPEN — a telemetry blip must not stop lookups). */
async function whoisjsonUsedThisMonth(now: Date): Promise<number | null> {
  const month = monthKey(now);
  if (
    quotaCache &&
    quotaCache.month === month &&
    now.getTime() - quotaCache.fetchedAt < QUOTA_CACHE_MS
  ) {
    return quotaCache.count;
  }
  const sb = createServiceClient();
  if (!sb) return null;
  const start = `${month}-01T00:00:00.000Z`;
  const { count, error } = await sb
    .from("cost_telemetry")
    .select("id", { count: "exact", head: true })
    .eq("feature", "whois")
    .eq("provider", "whoisjson")
    .gte("created_at", start);
  // A failed head-count returns count=null with NO error (204, no body) — the
  // null is the signal, not `error` (memory: head-count failures carry no error).
  if (error || count === null) {
    logger.warn("whoisjson quota count unavailable — guard open", {
      error: error?.message ?? "count null",
    });
    return null;
  }
  quotaCache = { month, count, fetchedAt: now.getTime() };
  return count;
}

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

  const now = new Date();
  const used = await whoisjsonUsedThisMonth(now);
  if (used !== null && used >= WHOISJSON_MONTHLY_GUARD) {
    const month = monthKey(now);
    if (lastGuardWarnMonth !== month) {
      lastGuardWarnMonth = month;
      logger.warn("whoisjson monthly guard reached — lookups skipped until next month", {
        used,
        guard: WHOISJSON_MONTHLY_GUARD,
      });
    }
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
      },
    );

    if (!res.ok) {
      logger.warn("WHOIS lookup failed", { status: res.status, domain });
      return EMPTY_RESULT;
    }

    // Volume telemetry against whoisjson's 1,000/month free cap. We count only
    // successful (200) lookups — non-200 responses return early above and aren't
    // logged, so this measures *served* lookups (the useful volume signal)
    // rather than every attempt. Free tier → estimatedCostUsd 0; the row exists
    // so /admin/costs + the weekly digest surface WHOIS volume as the D2/D3
    // chain, entity-enrichment, and persona-check all drive it. This is the
    // fleet-review "no cost signal → invisible" lesson applied to a free API.
    // Fire-and-forget (void) — telemetry never adds latency to or breaks the lookup.
    if (quotaCache && quotaCache.month === monthKey(now)) quotaCache.count += 1;
    void logCost({
      feature: "whois",
      provider: "whoisjson",
      operation: "domain-lookup",
      units: 1,
      estimatedCostUsd: 0,
    });

    const data = await res.json();

    // whoisjson.com returns `registrar` as an OBJECT ({ name, email, phone, … }),
    // not a string — the previous `data.registrar || …` short-circuited to the
    // object (truthy) and the typeof-string guard then nulled it. Read .name /
    // .email explicitly, with string + flat-field fallbacks for other providers.
    const reg = data.registrar;
    const registrar =
      (reg && typeof reg === "object"
        ? reg.name
        : typeof reg === "string"
          ? reg
          : null) ??
      data.registrar_name ??
      null;
    const registrarAbuseEmail =
      (reg && typeof reg === "object" && typeof reg.email === "string"
        ? reg.email
        : null) ?? null;

    // Registrant country is usually redacted; check the parsed-contact shapes
    // whoisjson actually uses (contacts.owner[].country) before flat fallbacks.
    const ownerContact = Array.isArray(data.contacts?.owner)
      ? data.contacts.owner[0]
      : data.contacts?.owner;
    const registrantCountry =
      ownerContact?.country ||
      data.registrant_country ||
      data.registrant?.country ||
      data.country ||
      null;

    const createdDate = parseDate(
      data.creation_date ||
        data.created ||
        data.created_date ||
        data.registered,
    );
    const expiresDate = parseDate(
      data.expiration_date ||
        data.expires ||
        data.registry_expiry_date ||
        data.expires_date,
    );

    // whoisjson uses `nameserver`; keep the other providers' field names too.
    const rawNameServers =
      data.nameserver ||
      data.name_servers ||
      data.nameservers ||
      data.name_server ||
      [];
    const nameServers = (
      Array.isArray(rawNameServers) ? rawNameServers : [rawNameServers]
    )
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
      registrarAbuseEmail,
      registrantCountry:
        typeof registrantCountry === "string" ? registrantCountry : null,
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
