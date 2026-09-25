// Review-app JSON fetcher — Deep Shop Check Stage 1 (reviews signal).
//
// A sibling of fetch-shop-page.ts: same transport (`safeFetch` — per-hop
// guard, SSRF-safe dispatcher, finite budget, byte cap), but it parses a JSON
// body instead of returning HTML.
// Kept separate because fetch-shop-page.ts's contract is explicitly "return
// HTML for the ABN scan" and callers destructure `.html`.
//
// The review-app endpoints (api.okendo.io, api-cdn.yotpo.com, …) are public
// and hardcoded by the per-app adapters; only the store identifier reaches the
// URL, and it is charset-validated at the detection layer. The SSRF guard is
// retained as defence-in-depth because that identifier originates in
// attacker-controlled page HTML.
//
// Only ever runs inside the shop-signal-enrich Inngest function (background),
// never the request path. Never throws — every failure yields { data: null,
// error }.

import { logger } from "@askarthur/utils/logger";
import { legacyFetchError } from "./fetch-shop-page";
import { safeFetch } from "./safe-fetch";

const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 5;
// Review JSON pages are small; 2 MB is a generous cap that still refuses an
// accidentally-unbounded body.
const MAX_BYTES = 2 * 1024 * 1024;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ReviewApiFetch {
  /** Parsed JSON body, or null on any failure. */
  data: unknown | null;
  /** HTTP status, when a response was received. */
  status: number | null;
  /** Failure reason, null on success. */
  error: string | null;
}

/**
 * GET a review-app JSON endpoint. Follows up to MAX_REDIRECTS redirects
 * manually, SSRF-checking every hop. Returns { data: null, error } on a
 * blocked URL, HTTP error, timeout, size cap, non-JSON body, or any network
 * failure — never throws. `budgetMs` caps total wall-clock across the chain.
 */
export async function fetchReviewApiJson(
  url: string,
  budgetMs: number = TIMEOUT_MS,
): Promise<ReviewApiFetch> {
  const r = await safeFetch(url, {
    method: "GET",
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json,*/*" },
    timeoutMs: budgetMs,
    maxBytes: MAX_BYTES,
    redirect: "follow-checked",
    maxRedirects: MAX_REDIRECTS,
    as: "json",
  });
  if (r.ok) return { data: r.body, status: r.status, error: null };
  const error = legacyFetchError(r);
  if (r.reason === "blocked" && r.detail === "private-redirect") {
    logger.warn("fetchReviewApiJson blocked a private-host redirect", { to: r.finalUrl });
  } else if (r.reason === "timeout" || r.reason === "network") {
    logger.warn("fetchReviewApiJson failed", { url, error, detail: r.detail });
  }
  return { data: null, status: r.status, error };
}
