// ABN extraction + verification — Deep Shop Check Stage 1.
//
// Given a shop page's HTML and its URL, decide whether the page displays a
// legitimate Australian Business Number. The research ranks "no ABN / ABN
// unregistered / ABN name-mismatch" as the #1 AU-specific fake-shop signal.
//
// Pipeline: gate on an .au host → scan visible text for 11-digit candidates
// → modulus-89 checksum (drops 11-digit phone numbers / order IDs) → verify
// the first valid candidate against the ABR register via lookupABN → match
// the registered entity name against the shop's brand (domain label + page
// title).
//
// `verifyShopAbn` is pure apart from the `lookupABN` delegate.
// `verifyShopAbnDeep` adds page I/O: it fetches the homepage and, for an
// .au shop with no homepage ABN, a small fixed set of candidate pages —
// the ABN often lives on /about or /terms, not the homepage (GitHub #349).

import { parse as parseTld } from "tldts";
import { lookupABN } from "./abr-lookup";
import { fetchShopPage, type ShopPageFetch } from "./fetch-shop-page";
import type { AbnStatus } from "@askarthur/types";

// Official ABN checksum weights (modulus 89).
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

// Company-form words + articles stripped before name matching — a shop's
// registered name routinely differs from its trading name only by these.
const NAME_STOPWORDS = new Set([
  "pty", "ltd", "limited", "proprietary", "pl",
  "the", "and", "co", "inc", "incorporated",
  "trading", "as", "ta", "group", "holdings", "enterprises",
  "australia", "australian", "aust",
]);

export interface ShopAbnResult {
  status: AbnStatus;
  abn: string | null;
  entityName: string | null;
}

/** True when the host is an Australian domain (ABN display is expected). */
export function isAuHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "au" || host.endsWith(".au");
  } catch {
    return false;
  }
}

/**
 * Validate an 11-digit ABN string with the official modulus-89 algorithm.
 * Subtract 1 from the first digit, apply the weight vector, sum, mod 89.
 */
export function isValidAbnChecksum(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const d = Number(digits[i]) - (i === 0 ? 1 : 0);
    sum += d * ABN_WEIGHTS[i];
  }
  return sum % 89 === 0;
}

function stripToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

/**
 * Extract candidate ABNs (11-digit, digits-only) from page HTML. Labelled
 * forms ("ABN: 11 005 357 522") rank first; bare 11-digit runs follow.
 * Returns deduplicated digit strings — caller applies the checksum filter.
 */
export function extractAbnCandidates(html: string): string[] {
  const text = stripToText(html);
  const seen = new Set<string>();
  const labelled: string[] = [];
  const bare: string[] = [];

  // Labelled: "ABN" / "A.B.N." optionally followed by punctuation, then 11
  // digits with arbitrary internal whitespace.
  const labelledRe = /A\.?B\.?N\.?[\s:.]*((?:\d[\s]*){11})/gi;
  for (const m of text.matchAll(labelledRe)) {
    const d = m[1].replace(/\D/g, "");
    if (d.length === 11 && !seen.has(d)) {
      seen.add(d);
      labelled.push(d);
    }
  }

  // Bare: any standalone run of 11 digits with optional single spaces, not
  // adjacent to another digit (avoids slicing 11 out of a longer number).
  const bareRe = /(?<!\d)\d(?:[  ]?\d){10}(?!\d)/g;
  for (const m of text.matchAll(bareRe)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length === 11 && !seen.has(d)) {
      seen.add(d);
      bare.push(d);
    }
  }

  return [...labelled, ...bare];
}

function normalizeTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t));
}

/**
 * Loose brand match: true when the candidate brand (a shop domain label or
 * page title) plausibly belongs to the registered entity. Deliberately
 * generous — a hard match would false-flag legitimate trading-name vs
 * registered-name differences.
 */
function nameMatches(entityName: string, candidate: string): boolean {
  const entityTokens = normalizeTokens(entityName);
  const candTokens = normalizeTokens(candidate);
  if (entityTokens.length === 0 || candTokens.length === 0) return false;

  const entityCollapsed = entityTokens.join("");
  const candCollapsed = candTokens.join("");
  if (
    candCollapsed.length >= 3 &&
    (entityCollapsed.includes(candCollapsed) ||
      candCollapsed.includes(entityCollapsed))
  ) {
    return true;
  }

  const entitySet = new Set(entityTokens);
  const overlap = candTokens.filter((t) => entitySet.has(t)).length;
  const smaller = Math.min(entityTokens.length, candTokens.length);
  return smaller > 0 && overlap / smaller >= 0.5;
}

function brandCandidates(html: string, url: string): string[] {
  const out: string[] = [];
  try {
    const label = parseTld(new URL(url).hostname).domainWithoutSuffix;
    if (label) out.push(label);
  } catch {
    // ignored — malformed URL
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  if (title) out.push(title);
  return out;
}

/**
 * Verify whether a shop page displays a legitimate ABN. Returns the status,
 * the ABN found (if any), and the registered entity name (if looked up).
 *
 * - non-AU host                → "not-applicable" (ABN display isn't expected)
 * - page could not be read     → "unverified" (pass `pageError`)
 * - no valid ABN on the page   → "no-abn"
 * - register lookup failed     → "unverified" (service error / bad GUID)
 * - ABN not on ABR / inactive  → "unregistered"
 * - ABN active, brand doesn't match holder → "name-mismatch"
 * - ABN active, brand matches holder       → "verified"
 *
 * `pageError` carries `fetchShopPage`'s failure reason: when the page was
 * unreadable we never saw it, so we must not assert `no-abn`.
 */
export async function verifyShopAbn(
  html: string,
  url: string,
  pageError?: string | null,
): Promise<ShopAbnResult> {
  if (!isAuHost(url)) {
    return { status: "not-applicable", abn: null, entityName: null };
  }

  // The shop page could not be read (timeout, Cloudflare/Akamai 403,
  // network error). We never actually saw the page, so we cannot claim it
  // displays no ABN — report `unverified` rather than a false `no-abn`.
  // See GitHub #349 (MINOR-2).
  if (pageError) {
    return { status: "unverified", abn: null, entityName: null };
  }

  const candidate = extractAbnCandidates(html).find(isValidAbnChecksum);
  if (!candidate) {
    return { status: "no-abn", abn: null, entityName: null };
  }

  const lookup = await lookupABN(candidate);
  if ("ok" in lookup) {
    // The register lookup returned no record. `not-found` is a real
    // signal — the displayed ABN is genuinely unregistered. `lookup-failed`
    // (ABR service error, bad GUID, an <exception> body) is NOT: reporting
    // it as `unregistered` would false-accuse a legitimate shop during an
    // ABR outage. See GitHub #349 (F-A).
    return lookup.reason === "not-found"
      ? { status: "unregistered", abn: candidate, entityName: null }
      : { status: "unverified", abn: candidate, entityName: null };
  }

  if (lookup.status.toLowerCase() !== "active") {
    return {
      status: "unregistered",
      abn: candidate,
      entityName: lookup.entityName,
    };
  }

  // Match the shop brand against the registered legal name AND any
  // registered business / trading names — a shop trading under a
  // registered business name that differs from its legal entity name
  // (routine for sole traders) is still legitimate.
  const matchTargets = [lookup.entityName, ...lookup.businessNames];
  const matched = brandCandidates(html, url).some((c) =>
    matchTargets.some((target) => nameMatches(target, c)),
  );
  return {
    status: matched ? "verified" : "name-mismatch",
    abn: candidate,
    entityName: lookup.entityName,
  };
}

// Candidate pages to try when an .au homepage shows no ABN. AU retailers
// routinely put the ABN in an About / Terms / Contact footer rather than
// the homepage (the Bunnings deep check proved it — GitHub #349). Ordered
// most- to least-likely; the first page that displays a checksum-valid ABN
// wins.
const ABN_CANDIDATE_PATHS = ["/about", "/about-us", "/contact", "/terms"];
// Total wall-clock budget shared across ALL candidate-page fetches, so a
// deep check's page I/O stays bounded however many candidates run. Worst
// case ≈ the homepage fetch (fetchShopPage's own default ~6s) + this.
const CANDIDATE_BUDGET_MS = 10_000;
// Per-candidate cap — one slow candidate must not eat the whole shared
// budget and starve the pages after it.
const PER_CANDIDATE_MS = 4_000;

/**
 * Deep ABN verification across a shop's homepage AND — for an .au shop
 * that shows no ABN on the homepage — a small fixed set of candidate
 * pages (`/about`, `/terms`, …).
 *
 * AU retailers routinely display their ABN in an About / Terms / Contact
 * footer, not on the homepage, so a homepage-only check reports a false
 * `no-abn` for legitimate shops (GitHub #349). This fetches the homepage
 * first; only a `no-abn` homepage result — which implies an .au host with
 * a readable homepage and no checksum-valid ABN — spends the candidate
 * budget. Any other homepage result (`verified`, `unregistered`,
 * `unverified`, `name-mismatch`, `not-applicable`) is already conclusive
 * and returned unchanged.
 *
 * Candidate fetches share one wall-clock deadline; a candidate that won't
 * load is skipped (it tells us nothing) rather than allowed to mask the
 * homepage's `no-abn`. The first candidate that displays a checksum-valid
 * ABN wins.
 *
 * `fetchPage` is injected for testing; production uses `fetchShopPage`.
 * Never throws — every failure mode degrades to a `ShopAbnResult`.
 */
export async function verifyShopAbnDeep(
  url: string,
  fetchPage: (
    u: string,
    budgetMs?: number,
  ) => Promise<ShopPageFetch> = fetchShopPage,
): Promise<ShopAbnResult> {
  const home = await fetchPage(url);
  const homeResult = await verifyShopAbn(
    home.html ?? "",
    home.finalUrl ?? url,
    home.error,
  );
  if (homeResult.status !== "no-abn") return homeResult;

  // `no-abn` ⇒ .au host, readable homepage, no ABN on it. Walk the
  // candidate pages under a single shared deadline.
  const base = home.finalUrl ?? url;
  const deadline = Date.now() + CANDIDATE_BUDGET_MS;
  for (const path of ABN_CANDIDATE_PATHS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    let candidateUrl: string;
    try {
      candidateUrl = new URL(path, base).href;
    } catch {
      continue; // a malformed base can't yield candidate URLs
    }

    const page = await fetchPage(
      candidateUrl,
      Math.min(remaining, PER_CANDIDATE_MS),
    );
    if (page.error) continue; // unreadable candidate — skip, don't mask

    const result = await verifyShopAbn(
      page.html ?? "",
      page.finalUrl ?? candidateUrl,
    );
    // `abn !== null` ⇒ the page displayed a checksum-valid ABN — that is
    // the answer (verified / name-mismatch / unregistered / unverified).
    // A `no-abn` or off-domain-redirect `not-applicable` keeps scanning.
    if (result.abn !== null) return result;
  }

  return homeResult; // no ABN on the homepage or any candidate page
}
