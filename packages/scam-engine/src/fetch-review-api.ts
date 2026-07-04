// Review-app JSON fetcher — Deep Shop Check Stage 1 (reviews signal).
//
// A sibling of fetch-shop-page.ts: same SSRF posture (isPrivateURL pre-check +
// per-redirect-hop check + ssrfSafeDispatcher for DNS-rebind defence + finite
// budget + byte cap), but it parses a JSON body instead of returning HTML.
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
import { isPrivateURL } from "./safebrowsing";
import { ssrfSafeDispatcher } from "./ssrf-dispatcher";

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
  if (isPrivateURL(url)) {
    return { data: null, status: null, error: "blocked-private-url" };
  }

  const deadline = Date.now() + budgetMs;
  let currentUrl = url;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { data: null, status: null, error: "timeout" };
      }

      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, Accept: "application/json,*/*" },
        signal: AbortSignal.timeout(remaining),
        ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
      });

      // Redirect hop — validate the Location target before fetching it.
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => {});
        const location = res.headers.get("location");
        if (!location) {
          return { data: null, status: res.status, error: "redirect-no-location" };
        }
        let next: string;
        try {
          next = new URL(location, currentUrl).href;
        } catch {
          return { data: null, status: res.status, error: "invalid-redirect" };
        }
        if (isPrivateURL(next)) {
          logger.warn("fetchReviewApiJson blocked a private-host redirect", {
            from: currentUrl,
            to: next,
          });
          return { data: null, status: res.status, error: "blocked-private-redirect" };
        }
        currentUrl = next;
        continue;
      }

      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        return { data: null, status: res.status, error: `http-${res.status}` };
      }

      const body = res.body;
      if (!body) {
        return { data: null, status: res.status, error: "empty-body" };
      }

      // Read the stream chunk by chunk, stopping at the size cap.
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let overflow = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > MAX_BYTES) {
            overflow = true;
            break;
          }
          chunks.push(value);
        }
      }
      await reader.cancel().catch(() => {});
      if (overflow) {
        return { data: null, status: res.status, error: "body-too-large" };
      }

      const buf = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        buf.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);

      try {
        return { data: JSON.parse(text), status: res.status, error: null };
      } catch {
        return { data: null, status: res.status, error: "invalid-json" };
      }
    }

    return { data: null, status: null, error: "too-many-redirects" };
  } catch (err) {
    const error =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "timeout"
        : "network-error";
    logger.warn("fetchReviewApiJson failed", { url, error, detail: String(err) });
    return { data: null, status: null, error };
  }
}
