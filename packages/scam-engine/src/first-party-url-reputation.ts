// First-party URL Reputation — Ask Arthur's own threat URLs as a URL-reputation
// source, beside Google Safe Browsing and VirusTotal.
//
// WHY. A Weaponised Clone Alert (our own urlscan verdict: live phishing on a
// lookalike of a named brand) becomes a Platform Entity (v309), which writes a
// `scam_urls` row. Until this module the analyze verdict never read that row:
// the web checker asked GSB + VirusTotal only, and the old post-hoc clone
// citation (apps/web/lib/clone-alert-lookup.ts) added a red flag without
// touching the verdict — so a user who checked a clone we had proven live
// could still be told SAFE. Here a hit enters `mergeVerdict` through the SAME
// seam as GSB/VT (`urlResults`), so it escalates to HIGH_RISK exactly as a GSB
// hit does, with one "URL flagged by …" red flag and the "do not click" step.
//
// WHICH ROWS COUNT (the load-bearing decision). A row counts only when it is
//   is_active AND confidence_level IN ('high','confirmed')
//   AND feed_sources overlaps VERIFIED_SOURCE_LABELS' keys.
// `confidence_level` alone is NOT enough: upsert_scam_url (the consumer
// "report this URL" RPC, v9) scores 'high' at 0.5, and FOUR reports from four
// distinct reporter hashes reach 0.65 (report factor 0.40 + diversity 0.15 +
// recency 0.10). Escalating on that would let four spoofed reports turn any
// legitimate site HIGH_RISK for every user. So the source must be a
// machine-verified first-party observation, named here, one line per source.
// Today that is `clone_watch` only (all 164 active high rows on 2026-09-23).
//
// MATCHING. Exact `normalized_url` via the unique btree
// (`scam_urls_normalized_url_key`) — one indexed IN query per request, no new
// index. Keys per submitted URL: its own normalized form (path-level rows)
// plus the ROOT of its host and each ancestor host down to the registrable
// domain, with and without `www.`, over http and https (host-level rows —
// every clone_watch row is a host root like `https://x.shop/`). We never match
// on the `domain` column: `aesop.us.com` is stored with domain `us.com`, and a
// domain match would tar every other *.us.com site.
//
// FAIL-OPEN. Never throws. A query error, a thrown client, or a lookup slower
// than LOOKUP_TIMEOUT_MS yields [] (no first-party signal) — GSB/VT and Claude
// proceed untouched. It runs in parallel with GSB/VT (and those with Claude),
// so on the happy path it adds no wall-clock latency. A failure writes a $0
// cost_telemetry error row (`first-party-url-reputation-error`), which the
// health digest pages on (feature LIKE '%error%') — same pattern as asic-lookup.
//
// PRIVACY. The keys are normalised forms of URLs the user submitted, sent as a
// query parameter to our own database and never stored. The hit log carries
// only our own stored threat row (a known-bad host) and the brand it targets.
//
// Gated FF_ANALYZE_FIRST_PARTY_URLS (default OFF): it changes user-facing
// verdicts, so it canaries separately.

import { parse as parseTld } from "tldts";
import { createServiceClient } from "@askarthur/supabase/server";
import { featureFlags } from "@askarthur/utils/feature-flags";
import { logger } from "@askarthur/utils/logger";
import { getLogger } from "@askarthur/utils/axiom-logger";
import { logCost } from "./cost-log";
import { normalizeURL } from "./url-normalize";
import { checkURLReputation, type URLCheckResult } from "./safebrowsing";

/** Upper bound on the lookup. Claude takes 1.5–3 s and GSB/VT up to 5 s, so
 *  1.5 s never lengthens a request; past it the signal is simply absent. */
export const LOOKUP_TIMEOUT_MS = 1_500;

/** Submitted URLs considered per request (bounds the IN list). */
const MAX_URLS = 10;
/** Hard cap on lookup keys (MAX_URLS × host variants, deduped). */
const MAX_KEYS = 120;
/** Ancestor hosts walked above the submitted host (login.a.b.x.shop → x.shop). */
const MAX_ANCESTORS = 4;

/** Every first-party source label starts with this, so a caller can tell a
 *  first-party hit from a GSB/VT one in a merged result (isFirstPartySource). */
export const FIRST_PARTY_SOURCE_PREFIX = "Ask Arthur ";

/** True when a URL-reputation `sources` entry came from this module. */
export function isFirstPartySource(source: string): boolean {
  return source.startsWith(FIRST_PARTY_SOURCE_PREFIX);
}

/**
 * The first-party sources whose high/confirmed rows escalate a verdict, and
 * how each is named in the "URL flagged by …" red flag. Adding a source is a
 * decision, not a formality: it must be a machine-verified observation, never
 * a report count (see header).
 */
const VERIFIED_SOURCE_LABELS: Record<string, (brand: string | null) => string> = {
  clone_watch: (brand) =>
    brand
      ? `${FIRST_PARTY_SOURCE_PREFIX}Clone Watch (live impersonation of ${brand})`
      : `${FIRST_PARTY_SOURCE_PREFIX}Clone Watch (live impersonation site)`,
};

export const FIRST_PARTY_VERIFIED_SOURCES = Object.keys(VERIFIED_SOURCE_LABELS);

const ESCALATING_CONFIDENCE = ["high", "confirmed"];

interface ScamUrlRow {
  normalized_url: string;
  brand_impersonated: string | null;
  feed_sources: string[] | null;
}

/** Hosts to probe for `host`: itself and each ancestor down to the registrable
 *  domain, each with and without a leading `www.`. Never the public suffix. */
function hostVariants(host: string): string[] {
  const bare = host.replace(/^www\./, "");
  const registrable = parseTld(bare).domain;
  const chain: string[] = [bare];
  if (registrable && bare !== registrable && bare.endsWith(`.${registrable}`)) {
    let h = bare;
    for (let i = 0; i < MAX_ANCESTORS && h !== registrable; i++) {
      h = h.slice(h.indexOf(".") + 1);
      chain.push(h);
    }
  }
  return chain.flatMap((h) => [h, `www.${h}`]);
}

/**
 * Pure: every `scam_urls.normalized_url` that, if flagged, would condemn
 * `rawUrl`. Its own normalised form, plus host-root rows for its host and its
 * ancestors (http + https, ± www). [] for a non-http(s) or unparseable URL.
 */
export function firstPartyLookupKeys(rawUrl: string): string[] {
  const n = normalizeURL(rawUrl);
  if (!n) return [];
  let host: string;
  try {
    host = new URL(n.normalized).hostname;
  } catch {
    return [];
  }
  const keys = new Set<string>([n.normalized]);
  for (const h of hostVariants(host)) {
    keys.add(`https://${h}/`);
    keys.add(`http://${h}/`);
  }
  return [...keys];
}

function logLookupError(message: string, requestId?: string): void {
  logger.warn("first-party url reputation: lookup failed", { error: message, requestId });
  logCost({
    feature: "first-party-url-reputation-error",
    provider: "supabase",
    operation: "scam_urls.lookup",
    units: 1,
    estimatedCostUsd: 0,
    metadata: { error: message },
  });
}

class LookupTimeout extends Error {}

/**
 * Look the submitted URLs up in our own threat URLs. Returns one flagged
 * result per submitted URL that matched (never a clean result — absence here
 * says nothing). Never throws; bounded by LOOKUP_TIMEOUT_MS.
 */
export async function checkFirstPartyUrlReputation(
  urls: string[],
  opts: { requestId?: string; source?: string; timeoutMs?: number } = {},
): Promise<URLCheckResult[]> {
  const perUrl = urls.slice(0, MAX_URLS).map((url) => ({
    url,
    keys: firstPartyLookupKeys(url),
  }));
  const allKeys = [...new Set(perUrl.flatMap((u) => u.keys))].slice(0, MAX_KEYS);
  if (allKeys.length === 0) return [];

  let rows: ScamUrlRow[];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sb = createServiceClient();
    if (!sb) return [];
    const query = sb
      .from("scam_urls")
      .select("normalized_url, brand_impersonated, feed_sources")
      .in("normalized_url", allKeys)
      .eq("is_active", true)
      .in("confidence_level", ESCALATING_CONFIDENCE)
      .overlaps("feed_sources", FIRST_PARTY_VERIFIED_SOURCES)
      .limit(allKeys.length);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new LookupTimeout(`timed out after ${opts.timeoutMs ?? LOOKUP_TIMEOUT_MS}ms`)),
        opts.timeoutMs ?? LOOKUP_TIMEOUT_MS,
      );
    });
    const { data, error } = (await Promise.race([query, timeout])) as {
      data: ScamUrlRow[] | null;
      error: { message: string } | null;
    };
    if (error) {
      logLookupError(error.message, opts.requestId);
      return [];
    }
    rows = data ?? [];
  } catch (err) {
    logLookupError(err instanceof Error ? err.message : String(err), opts.requestId);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (rows.length === 0) return [];

  const byKey = new Map(rows.map((r) => [r.normalized_url, r]));
  const results: URLCheckResult[] = [];
  for (const { url, keys } of perUrl) {
    const row = keys.map((k) => byKey.get(k)).find((r) => r !== undefined);
    if (!row) continue;
    const labels = (row.feed_sources ?? [])
      .filter((s) => s in VERIFIED_SOURCE_LABELS)
      .map((s) => VERIFIED_SOURCE_LABELS[s](row.brand_impersonated));
    if (labels.length === 0) continue; // defensive: the SQL overlap already guarantees one
    results.push({ url, isMalicious: true, sources: labels });
  }

  if (results.length > 0) {
    // A real user checking a URL we hold as a live threat is a rare, high-value
    // event — always-ship warn (bypasses the 10% INFO sample). No-op when
    // FF_AXIOM_ENABLED is off. Our own stored threat row only, never user text.
    const axiom = getLogger({ source: opts.source ?? "api/analyze", requestId: opts.requestId });
    axiom.warn("first_party_url_hit", {
      hits: results.length,
      matched: rows.map((r) => r.normalized_url),
      brands: rows.map((r) => r.brand_impersonated).filter(Boolean),
    });
    void axiom.flush().catch(() => {});
  }
  return results;
}

/**
 * Pure: union two URL-reputation result lists by URL — sources concatenated
 * (deduped), `isMalicious` true if either says so. Order follows `base`, then
 * any URL only `extra` knows about.
 */
export function mergeUrlReputation(
  base: URLCheckResult[],
  extra: URLCheckResult[],
): URLCheckResult[] {
  const out = new Map<string, URLCheckResult>();
  for (const r of [...base, ...extra]) {
    const prev = out.get(r.url);
    if (!prev) {
      out.set(r.url, { url: r.url, isMalicious: r.isMalicious, sources: [...r.sources] });
      continue;
    }
    prev.isMalicious = prev.isMalicious || r.isMalicious;
    for (const s of r.sources) if (!prev.sources.includes(s)) prev.sources.push(s);
  }
  return [...out.values()];
}

/**
 * The analyze pipeline's URL reputation: GSB + VirusTotal and, when
 * FF_ANALYZE_FIRST_PARTY_URLS is on, our own threat URLs — in parallel, merged
 * per URL. The one URL-reputation call for every surface that reads
 * `scam_urls` as a reputation signal: `/api/analyze`, runAnalysisCore
 * (extension `/analyze` + bots), `/api/extension/analyze-ad` and
 * `/api/extension/url-check` — so their keys and verified-source predicate
 * cannot drift. Pinned per surface by apps/web/__tests__/
 * {analyzeFirstPartyUrls,extensionAnalyzeAdFirstParty,extensionUrlCheckFirstParty}
 * and analyze-core-first-party. `/api/extension/analyze-checkout` calls
 * `checkFirstPartyUrlReputation` directly (same keys + predicate; it scores
 * its own signals rather than merging GSB/VT) as its decisive
 * `firstPartyListed` signal, beside a feed-only host-presence check
 * (`source_type='feed'`, so report-driven rows never count there either). The B2B/mobile lookup routes (`/api/v1/threats/*`,
 * `/api/scam-urls/lookup`, `/api/mobile/threat-snapshot`) return rows, they
 * do not escalate a verdict. Never throws on the first-party half.
 */
export async function checkAnalyzeUrlReputation(
  urls: string[],
  opts: { requestId?: string; source?: string } = {},
): Promise<URLCheckResult[]> {
  if (urls.length === 0) return [];
  const [thirdParty, firstParty] = await Promise.all([
    checkURLReputation(urls),
    featureFlags.analyzeFirstPartyUrls
      ? checkFirstPartyUrlReputation(urls, opts)
      : Promise.resolve([] as URLCheckResult[]),
  ]);
  return firstParty.length > 0 ? mergeUrlReputation(thirdParty, firstParty) : thirdParty;
}
