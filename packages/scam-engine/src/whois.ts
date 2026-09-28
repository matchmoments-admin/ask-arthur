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
  /**
   * Present ONLY when no answer was obtained and asking again later may give
   * one (#1253). Absent on a served lookup — including a 200 that carries no
   * registrar, which is a real answer. Before this field every one of these
   * paths returned the same all-null result as a served-but-empty lookup, so
   * the clone-watch enricher saved a quota-skipped lookup as the row's FINAL
   * attribution: ~130 rows a month kept no registrar forever (prod
   * 2026-09-26). A caller that persists a result must not stamp it as final,
   * or as a fresh cache entry, when this is set.
   */
  deferral?: WhoisDeferral;
}

export type WhoisDeferralReason =
  /** The monthly guard for this priority is spent (no request made), or
   *  whoisjson answered 429 — quota exhaustion, never a failure strike. */
  | "quota_deferred"
  /** A `batch` lookup whose monthly count could not be read (PR-F): the guard
   *  fails CLOSED for batch, so no request was made. Not quota exhaustion and
   *  not a failure — never a strike; retried in 24h (a telemetry blip should
   *  not park a row until the 1st). Interactive callers never see it. */
  | "quota_unknown"
  /** whoisjson answered another non-200, or the request threw / timed out. */
  | "http_error"
  /** WHOIS_API_KEY is not set — no request was made. */
  | "not_configured";

export interface WhoisDeferral {
  reason: WhoisDeferralReason;
  /** ISO timestamp: the 1st of next month (UTC) for quota_deferred and
   *  not_configured — when the guard's count resets, and a missing key is not
   *  fixed by asking daily — else (http_error, quota_unknown) now + 24h. */
  retryAfter: string;
  /** HTTP status, when whoisjson answered (429 or another non-200). */
  status?: number;
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

/** Retry delay after a failed request (http_error), and after a batch lookup
 *  held because the monthly count was unreadable (quota_unknown). */
export const WHOIS_HTTP_RETRY_MS = 24 * 60 * 60 * 1000;

/** The first instant of the next calendar month, UTC — when the guard's
 *  count resets (monthKey() buckets by UTC month). */
export function startOfNextMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

function deferred(
  reason: WhoisDeferralReason,
  now: Date,
  status?: number,
): WhoisResult {
  const retryAfter =
    reason === "http_error" || reason === "quota_unknown"
      ? new Date(now.getTime() + WHOIS_HTTP_RETRY_MS)
      : startOfNextMonthUtc(now);
  return {
    ...EMPTY_RESULT,
    nameServers: [],
    deferral: {
      reason,
      retryAfter: retryAfter.toISOString(),
      ...(status !== undefined ? { status } : {}),
    },
  };
}

/**
 * Monthly quota guard. whoisjson's free tier is 1,000 lookups/month and the
 * fleet was running ~1,200–1,300 (2026-09 review): past the cap every caller
 * silently got nothing for the rest of the month. Callers declare a priority so
 * batch enrichment stops early and user-facing checks keep headroom:
 *   - `interactive` (persona-check, scam-URL reports, shop/checkout and charity
 *     checks): may use up to 950 this month.
 *   - `batch` (clone-watch attribution, entity/URL enrichment crons): stops at 700.
 *
 * `priority` is REQUIRED on `lookupWhois` and `lookupDomainRegistration`
 * (PR-F): it used to default to `interactive`, and `lookupDomainRegistration`
 * passed `undefined` through, so a batch caller that forgot the argument
 * silently got the 950 share instead of 700.
 *
 * The count is this month's SERVED lookups — the `whois`/`whoisjson` rows this
 * module writes on a 200. Non-200 responses aren't counted, so the provider's
 * own quota may be consumed faster than this counter shows; the margins below
 * 1,000 absorb that. The row is AWAITED before the lookup returns (PR-F): it
 * was fire-and-forget, and ADR-0019 records that a finish-cancelled Inngest
 * run kills un-awaited promises — so the batch lanes, the heaviest callers,
 * were the ones most likely to lose the row that counts them. A rejected
 * insert is still swallowed by `logCost` (logged, not thrown), so the count
 * remains a lower bound; the margins below 1,000 absorb that too.
 *
 * Two known softnesses, both deliberate:
 *   - The count is cached PER INSTANCE for 10 minutes (`QUOTA_CACHE_MS`) and
 *     advanced locally on each served lookup. Lookups served by OTHER
 *     instances in that window are invisible to this one, so the guard can
 *     overshoot by whatever the rest of the fleet serves in 10 minutes —
 *     small against the 300 (batch) / 50 (interactive) margins.
 *   - When the count cannot be read at all, `batch` fails CLOSED
 *     (`quota_unknown`, no request — a cron can wait a day, and an unmetered
 *     batch run is exactly how the fleet reached ~1,300/month) and
 *     `interactive` fails OPEN (a user is waiting, and a telemetry blip must
 *     not blank their check).
 */
export type WhoisPriority = "interactive" | "batch";
export const WHOISJSON_MONTHLY_GUARD: Record<WhoisPriority, number> = {
  interactive: 950,
  batch: 700,
};
const QUOTA_CACHE_MS = 10 * 60 * 1000;
let quotaCache: { month: string; count: number; fetchedAt: number } | null =
  null;
let lastGuardWarnKey: string | null = null;

/** Reset the in-process quota cache — tests only. */
export function __resetWhoisQuotaCacheForTests(): void {
  quotaCache = null;
  lastGuardWarnKey = null;
}

function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** This month's served whoisjson lookups, or null when the count can't be
 *  read (the guard then fails CLOSED for batch, OPEN for interactive — see
 *  WhoisPriority). */
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
    logger.warn("whoisjson quota count unavailable — batch held, interactive open", {
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
 * 5s timeout, non-blocking — never throws. A lookup that got no answer (quota
 * guard, non-200, network error, no key) returns the all-null result with
 * `deferral` set, so a caller can tell it from a served-but-empty record.
 */
export async function lookupWhois(
  domain: string,
  opts: { priority: WhoisPriority },
): Promise<WhoisResult> {
  const priority: WhoisPriority = opts.priority;
  const apiKey = process.env.WHOIS_API_KEY;
  const now = new Date();
  if (!apiKey) {
    logger.warn("WHOIS_API_KEY not set, skipping WHOIS lookup");
    return deferred("not_configured", now);
  }

  const used = await whoisjsonUsedThisMonth(now);
  // Unreadable count: batch fails CLOSED, interactive OPEN (see WhoisPriority).
  if (used === null && priority === "batch") {
    return deferred("quota_unknown", now);
  }
  const guard = WHOISJSON_MONTHLY_GUARD[priority];
  if (used !== null && used >= guard) {
    const warnKey = `${monthKey(now)}:${priority}`;
    if (lastGuardWarnKey !== warnKey) {
      lastGuardWarnKey = warnKey;
      logger.warn(
        "whoisjson monthly guard reached — lookups skipped until next month",
        {
          used,
          guard,
          priority,
        },
      );
    }
    return deferred("quota_deferred", now);
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
      // A 429 is whoisjson's quota (or rate) wall — the provider's own count
      // runs ahead of our guard, which counts only served 200s. It is quota
      // exhaustion, NOT a failure (CLAUDE.md: a 429 never bumps a failure
      // streak), so it defers to the guard's reset like the guard itself.
      // whoisjson documents no other quota status that we have verified; any
      // other non-200 is an http_error.
      return deferred(
        res.status === 429 ? "quota_deferred" : "http_error",
        now,
        res.status,
      );
    }

    // Volume telemetry against whoisjson's 1,000/month free cap. We count only
    // successful (200) lookups — non-200 responses return early above and aren't
    // logged, so this measures *served* lookups (the useful volume signal)
    // rather than every attempt. Free tier → estimatedCostUsd 0; the row exists
    // so /admin/costs + the weekly digest surface WHOIS volume as the D2/D3
    // chain, entity-enrichment, and persona-check all drive it. This is the
    // fleet-review "no cost signal → invisible" lesson applied to a free API.
    // AWAITED (PR-F): this row IS the quota guard's count, so it must be
    // written before the lookup returns — a fire-and-forget write is lost when
    // an Inngest run is finish-cancelled (ADR-0019), and the guard then
    // undercounts. One insert of latency; logCost never throws.
    if (quotaCache && quotaCache.month === monthKey(now)) quotaCache.count += 1;
    // The insert runs concurrently with the body parse, and `finally` awaits
    // it on BOTH paths — so the row is written before the lookup returns even
    // when the body fails to parse (the lookup was served; it counts).
    const logged = logCost({
      feature: "whois",
      provider: "whoisjson",
      operation: "domain-lookup",
      units: 1,
      estimatedCostUsd: 0,
    });
    let data: Awaited<ReturnType<Response["json"]>>;
    try {
      data = await res.json();
    } finally {
      await logged;
    }

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
    return deferred("http_error", now);
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

/**
 * True when the lookup was HELD by the batch guard because the monthly count
 * was unreadable (`quota_unknown`, PR-F) — no request was made, and asking
 * again once the count reads may answer. A worklist writer must leave such a
 * row IN its worklist (not `completed`): scam_urls and scam_entities have no
 * WHOIS re-offer path, so a row stamped completed here would lose WHOIS for
 * good. Before PR-F an unreadable count failed open, so this never arose.
 * Other deferrals keep their #1253 behaviour (the row completes without
 * whois_* columns).
 */
export function whoisHeldForRetry(
  w: Pick<WhoisResult, "deferral"> | null | undefined,
): boolean {
  return w?.deferral?.reason === "quota_unknown";
}

/**
 * The `scam_urls.whois_*` columns for a lookup result — the ONE mapping the
 * scam_urls writers share (enrichment.ts, on-demand-url-enrich.ts,
 * /api/scam-urls/report; they were three hand-kept copies). An unanswered
 * lookup (`deferral` set) maps to NO columns (#1253): not nulls over existing
 * values, and no `whois_lookup_at`, which whois-cached.ts and the report
 * route read as "this domain has WHOIS data".
 */
export function whoisScamUrlColumns(
  w: WhoisResult,
  lookupAt: string,
): Record<string, unknown> {
  if (w.deferral) return {};
  return {
    whois_registrar: w.registrar,
    whois_registrant_country: w.registrantCountry,
    whois_created_date: w.createdDate,
    whois_expires_date: w.expiresDate,
    whois_name_servers: w.nameServers,
    whois_is_private: w.isPrivate,
    whois_raw: w.raw,
    whois_lookup_at: lookupAt,
  };
}
