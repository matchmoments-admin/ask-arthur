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
// title). Only I/O is the lookupABN delegate.

import { parse as parseTld } from "tldts";
import { lookupABN } from "./abr-lookup";
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
 * - non-AU host       → "not-applicable" (ABN display isn't expected)
 * - no valid ABN      → "no-abn"
 * - ABN not on ABR / inactive → "unregistered"
 * - ABN active, brand doesn't match holder → "name-mismatch"
 * - ABN active, brand matches holder       → "verified"
 */
export async function verifyShopAbn(
  html: string,
  url: string,
): Promise<ShopAbnResult> {
  if (!isAuHost(url)) {
    return { status: "not-applicable", abn: null, entityName: null };
  }

  const candidate = extractAbnCandidates(html).find(isValidAbnChecksum);
  if (!candidate) {
    return { status: "no-abn", abn: null, entityName: null };
  }

  const record = await lookupABN(candidate);
  if (!record) {
    return { status: "unregistered", abn: candidate, entityName: null };
  }
  if (record.status.toLowerCase() !== "active") {
    return {
      status: "unregistered",
      abn: candidate,
      entityName: record.entityName,
    };
  }

  const matched = brandCandidates(html, url).some((c) =>
    nameMatches(record.entityName, c),
  );
  return {
    status: matched ? "verified" : "name-mismatch",
    abn: candidate,
    entityName: record.entityName,
  };
}
