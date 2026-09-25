// Shop-page fetcher — Deep Shop Check Stage 1.
//
// Single-purpose: retrieve a shop page's HTML so abn-extract.ts can scan it
// for a displayed Australian Business Number. Deliberately NOT the
// site-audit scanner's attemptFetch — that is private to @askarthur/site-audit
// and returns an audit-tuned error taxonomy; importing it would couple
// scam-engine to site-audit. This is the smallest correct fetch instead.
//
// Only ever runs inside the shop-signal-enrich Inngest function (background),
// never the request path. Never throws — every failure mode yields
// { html: null, error }.
//
// Transport: `safeFetch` (./safe-fetch) owns the guard on every redirect hop,
// the SSRF-safe dispatcher, the chain-wide timeout, the redirect bound and
// the streamed byte cap (truncating — the ABN is near the top or footer of a
// page, so a truncated page is still useful). This file keeps only the shop-
// check policy and the legacy error vocabulary (`legacyFetchError`).

import { logger } from "@askarthur/utils/logger";
import { safeFetch, type SafeFetchResult } from "./safe-fetch";

// Default total budget across the whole redirect chain (not per-hop) — a
// caller may pass a smaller `budgetMs`. Keeps the shop-signal-enrich
// duration estimate honest no matter how many hops a shop's CDN inserts.
const TIMEOUT_MS = 6_000;
// Follow at most this many redirects before giving up.
const MAX_REDIRECTS = 5;
// 512 KB is plenty to reach an ABN in a page footer / "About" copy without
// pulling a multi-megabyte SPA bundle into memory.
const MAX_BYTES = 512 * 1024;
// Fake-shop hosts frequently 403 a generic bot UA; present a real browser UA.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ShopPageFetch {
  /** Decoded HTML, capped at MAX_BYTES. null on any failure. */
  html: string | null;
  /** Final URL after redirects, when the fetch resolved. */
  finalUrl: string | null;
  /** HTTP status, when a response was received. */
  status: number | null;
  /** Failure reason, null on success. */
  error: string | null;
}

/**
 * Fetch a shop page's HTML. Follows up to MAX_REDIRECTS redirects manually,
 * SSRF-checking every hop. Returns { html: null, error } on a blocked URL,
 * HTTP error, timeout, size cap, redirect-limit, or any network failure —
 * never throws.
 *
 * `budgetMs` caps total wall-clock time across the whole redirect chain;
 * it defaults to TIMEOUT_MS. `verifyShopAbnDeep` passes a shrinking slice
 * of a shared deadline so a fixed set of candidate-page fetches stays
 * inside one overall budget.
 */
export async function fetchShopPage(
  url: string,
  budgetMs: number = TIMEOUT_MS,
): Promise<ShopPageFetch> {
  const r = await safeFetch(url, {
    method: "GET",
    headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
    timeoutMs: budgetMs,
    maxBytes: MAX_BYTES,
    // The ABN sits in the page head/footer copy — keep the first MAX_BYTES.
    truncate: true,
    redirect: "follow-checked",
    maxRedirects: MAX_REDIRECTS,
    as: "text",
  });
  if (r.ok) {
    return { html: r.body, finalUrl: r.finalUrl, status: r.status, error: null };
  }
  const error = legacyFetchError(r);
  if (r.reason === "blocked" && r.detail === "private-redirect") {
    logger.warn("fetchShopPage blocked a private-host redirect", { to: r.finalUrl });
  } else if (r.reason === "timeout" || r.reason === "network") {
    logger.warn("fetchShopPage failed", { url, error, detail: r.detail });
  }
  return {
    html: null,
    finalUrl: keepsFinalUrl(r) ? r.finalUrl : null,
    status: r.status,
    error,
  };
}

/**
 * The error vocabulary shop-signal and the review fetcher have always
 * reported (their callers and tests key on these strings), mapped from a
 * `safeFetch` failure.
 */
export function legacyFetchError(r: Extract<SafeFetchResult<unknown>, { ok: false }>): string {
  switch (r.reason) {
    case "blocked":
      if (r.detail === "private-url") return "blocked-private-url";
      if (r.detail === "private-redirect") return "blocked-private-redirect";
      return "network-error"; // refused at connect (resolved to a private IP)
    case "redirects":
      if (r.detail === "no-location") return "redirect-no-location";
      if (r.detail === "invalid-location") return "invalid-redirect";
      return "too-many-redirects"; // limit, or a loop (which used to run to the limit)
    case "http":
      return `http-${r.status}`;
    case "no_body":
      return "empty-body";
    case "too_large":
      return "body-too-large";
    case "invalid_json":
      return "invalid-json";
    case "timeout":
      return "timeout";
    default:
      return "network-error";
  }
}

function keepsFinalUrl(r: Extract<SafeFetchResult<unknown>, { ok: false }>): boolean {
  return (
    r.reason === "http" ||
    r.reason === "redirects" ||
    r.reason === "no_body" ||
    (r.reason === "blocked" && r.detail === "private-redirect")
  );
}
