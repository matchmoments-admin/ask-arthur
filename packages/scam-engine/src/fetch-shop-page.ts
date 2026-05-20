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
// Hard requirements:
//   - SSRF guard via isPrivateURL BEFORE the fetch, and a re-check of the
//     post-redirect final URL (a redirect to a private host is the bypass).
//   - Finite timeout.
//   - Response-body size cap — never read an unbounded body into memory.

import { logger } from "@askarthur/utils/logger";
import { isPrivateURL } from "./safebrowsing";

const TIMEOUT_MS = 6_000;
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
 * Fetch a shop page's HTML. Returns { html: null, error } on a blocked URL,
 * HTTP error, timeout, size cap, or any network failure — never throws.
 */
export async function fetchShopPage(url: string): Promise<ShopPageFetch> {
  if (isPrivateURL(url)) {
    return { html: null, finalUrl: null, status: null, error: "blocked-private-url" };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Real fetch always populates res.url; fall back to the (already
    // SSRF-checked) request URL if a runtime ever leaves it empty.
    const finalUrl = res.url || url;

    // A redirect chain that lands on a private host is the SSRF bypass —
    // discard the body and refuse.
    if (isPrivateURL(finalUrl)) {
      return {
        html: null,
        finalUrl,
        status: res.status,
        error: "blocked-private-redirect",
      };
    }

    if (!res.ok) {
      return {
        html: null,
        finalUrl,
        status: res.status,
        error: `http-${res.status}`,
      };
    }

    const body = res.body;
    if (!body) {
      return { html: null, finalUrl, status: res.status, error: "empty-body" };
    }

    // Read the stream chunk by chunk, stopping at the size cap.
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    await reader.cancel().catch(() => {});

    const buf = new Uint8Array(Math.min(total, MAX_BYTES));
    let offset = 0;
    for (const chunk of chunks) {
      const room = buf.length - offset;
      if (room <= 0) break;
      buf.set(chunk.subarray(0, room), offset);
      offset += Math.min(chunk.byteLength, room);
    }

    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { html, finalUrl, status: res.status, error: null };
  } catch (err) {
    const error =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "timeout"
        : "network-error";
    logger.warn("fetchShopPage failed", { url, error, detail: String(err) });
    return { html: null, finalUrl: null, status: null, error };
  }
}
