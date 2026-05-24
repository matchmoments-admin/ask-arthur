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
//   - SSRF guard via isPrivateURL on the initial URL AND on every redirect
//     hop. Redirects are followed manually (redirect: "manual") so each
//     Location is validated BEFORE it is fetched — a redirect into an
//     internal host is the classic SSRF bypass that redirect: "follow"
//     would silently issue mid-chain. Mirrors redirect-resolver.ts's
//     per-hop check.
//   - Resolution-time SSRF guard via `ssrfSafeDispatcher`. isPrivateURL is
//     purely syntactic and lets a hostname through that A-records to a
//     private IP (e.g. `rebind.example.com → 127.0.0.1`), AND it cannot
//     defend against DNS rebinding where the host resolves to a public IP
//     at check-time and a private IP at fetch-time. The dispatcher hooks
//     undici's per-connection lookup and rejects the resolved IP if it is
//     private — closing both windows. Issue #353.
//   - Finite total timeout across the whole redirect chain.
//   - Bounded redirect count.
//   - Response-body size cap — never read an unbounded body into memory.

import { logger } from "@askarthur/utils/logger";
import { isPrivateURL } from "./safebrowsing";
import { ssrfSafeDispatcher } from "./ssrf-dispatcher";

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
  if (isPrivateURL(url)) {
    return { html: null, finalUrl: null, status: null, error: "blocked-private-url" };
  }

  const deadline = Date.now() + budgetMs;
  let currentUrl = url;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return { html: null, finalUrl: null, status: null, error: "timeout" };
      }

      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, Accept: "text/html,*/*" },
        signal: AbortSignal.timeout(remaining),
        // `dispatcher` is undici-specific (Node 22's fetch is undici);
        // not in lib.dom RequestInit. The cast is intentional.
        ...({ dispatcher: ssrfSafeDispatcher } as Record<string, unknown>),
      });

      // ── Redirect hop ──────────────────────────────────────────────────
      // redirect: "manual" hands us the raw 3xx so the Location target can
      // be validated before it is fetched. A redirect into a private host
      // is the SSRF bypass — refuse it; the internal host is never contacted.
      if (res.status >= 300 && res.status < 400) {
        // Drain the (small) redirect body so undici can reuse the socket.
        await res.body?.cancel().catch(() => {});

        const location = res.headers.get("location");
        if (!location) {
          return {
            html: null,
            finalUrl: currentUrl,
            status: res.status,
            error: "redirect-no-location",
          };
        }
        let next: string;
        try {
          next = new URL(location, currentUrl).href;
        } catch {
          return {
            html: null,
            finalUrl: currentUrl,
            status: res.status,
            error: "invalid-redirect",
          };
        }
        if (isPrivateURL(next)) {
          logger.warn("fetchShopPage blocked a private-host redirect", {
            from: currentUrl,
            to: next,
          });
          return {
            html: null,
            finalUrl: next,
            status: res.status,
            error: "blocked-private-redirect",
          };
        }
        currentUrl = next;
        continue;
      }

      // ── Final response ────────────────────────────────────────────────
      if (!res.ok) {
        return {
          html: null,
          finalUrl: currentUrl,
          status: res.status,
          error: `http-${res.status}`,
        };
      }

      const body = res.body;
      if (!body) {
        return {
          html: null,
          finalUrl: currentUrl,
          status: res.status,
          error: "empty-body",
        };
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
      return { html, finalUrl: currentUrl, status: res.status, error: null };
    }

    // Loop exhausted — every iteration was a redirect.
    return {
      html: null,
      finalUrl: currentUrl,
      status: null,
      error: "too-many-redirects",
    };
  } catch (err) {
    const error =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "timeout"
        : "network-error";
    logger.warn("fetchShopPage failed", { url, error, detail: String(err) });
    return { html: null, finalUrl: null, status: null, error };
  }
}
